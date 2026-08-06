/**
 * Structuring worker — picks up submitted drafts and structures them.
 *
 * Failure posture (Invariant 15 / AC-8): the card ALWAYS stays in draft
 * with raw answers intact when anything fails. Every failure is recorded
 * and retried with backoff; killing the process mid-structuring loses
 * nothing because claims + status move in one save after success.
 *
 * Spot-check (JP, Aug 6 — the FR-11 HOLD is retired): freshly structured
 * cards go straight to the talent. JP reviews released cards from the
 * spot-check queue instead; his fix window runs until the card reaches
 * a checker. Calibration-mode exit stays JP-owned (Invariant 14).
 */

import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { User } from '../models/User.js';
import { structureCard, remapClaim, draftBoltInLine, trackReadyForStructuring, StructuringError } from '../services/structurerService.js';
import { taskScaffold } from '../services/capsService.js';
import { transition } from '../services/statusMachine.js';
import { pushCardAudit, recordAudit } from '../services/auditService.js';

const POLL_INTERVAL_MS = 15_000;
const BACKOFF_BASE_MS = 30_000; // 30s, 60s, 120s, ... capped at 15 min

let timer = null;
let running = false;

export function startStructurerWorker({ intervalMs = POLL_INTERVAL_MS } = {}) {
  timer = setInterval(() => {
    runStructuringPass().catch((err) => console.error('[structurer] pass failed', err));
  }, intervalMs);
  console.log('Structurer worker polling for submitted drafts');
}

export function stopStructurerWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runStructuringPass({ client } = {}) {
  if (running) return; // one pass at a time
  running = true;
  try {
    const now = new Date();
    const candidates = await Card.find({
      status: 'draft',
      submittedForStructuringAt: { $ne: null },
      $or: [{ nextStructuringAttemptAt: null }, { nextStructuringAttemptAt: { $lte: now } }],
    }).limit(5);

    for (const card of candidates) {
      await structureOne(card, { client });
    }

    await runContentionPass({ client });
    await runBoltInPass({ client });
  } finally {
    running = false;
  }
}

/**
 * C2v2: closed bolt-in / signal threads get their line drafted here —
 * never in the request path. Same wall as everything else: controlled
 * vocabulary only, verbatim quotes, thin words become a flagged draft.
 */
export async function runBoltInPass({ client } = {}) {
  const cards = await Card.find({
    status: 'structured',
    'boltInThreads.status': 'structuring',
  }).limit(5);

  for (const card of cards) {
    const track = await Track.findOne({ key: card.track });
    if (!track || !trackReadyForStructuring(track)) continue;

    for (const thread of card.boltInThreads) {
      if (thread.status !== 'structuring') continue;
      if (thread.attempts >= 3) {
        thread.status = 'nothing';
        thread.response =
          'This could not be written up (a system problem, not you). Open it again to retry, or ask JP.';
        pushCardAudit(card, { by: null, action: 'bolt-in-draft-failed', note: `gave up after ${thread.attempts} attempts` });
        continue;
      }
      try {
        const words = thread.thread.filter((t) => t.role === 'talent').map((t) => t.text);
        const opts = client ? { client } : {};
        const { claims, explanation } = await draftBoltInLine(
          track,
          card,
          { competency: thread.competency, signal: thread.fromSignal, threadWords: words },
          opts,
        );
        if (claims.length) {
          card.claims.push(...claims);
          thread.status = 'done';
          thread.competency = thread.competency ?? claims[0].competencyOrDomain;
          thread.response = explanation || 'Added to your card — check the new line.';
          // A claimed signal stops being "noted, not claimed".
          if (thread.fromSignal) {
            card.signalsNoted = card.signalsNoted.filter((s) => s.signal !== thread.fromSignal);
          }
        } else {
          thread.status = 'nothing';
          thread.response = explanation || 'Not enough here to make a line yet. Open it again and add more, any time.';
        }
        pushCardAudit(card, {
          by: null,
          action: 'bolt-in-drafted',
          after: { competency: thread.competency, lines: claims.length },
        });
      } catch (err) {
        thread.attempts += 1; // retried next pass; capped above
        console.error('[structurer] bolt-in draft failed', err.message);
      }
    }
    await card.save();
  }
}

const MAX_CONTENTION_ATTEMPTS = 3;

/**
 * A4 contention loop: answer open contentions — re-map the line or
 * explain. A mapping is never final over the talent's objection; the
 * answered line always returns to the talent (never auto-approved).
 */
export async function runContentionPass({ client } = {}) {
  const cards = await Card.find({
    status: { $in: ['structured', 'adjust'] },
    'claims.contentions.outcome': null,
  }).limit(5);

  const outcomes = [];
  for (const card of cards) {
    const track = await Track.findOne({ key: card.track });
    if (!track || !trackReadyForStructuring(track)) continue;

    for (const claim of card.claims) {
      const open = (claim.contentions || []).find((c) => c.outcome === null);
      if (!open) continue;

      if (open.attempts >= MAX_CONTENTION_ATTEMPTS) {
        open.outcome = 'explained';
        open.response =
          'This line could not be re-checked (a system problem, not you). It stays as drafted — you can still fix it, remove it, or ask JP.';
        open.respondedAt = new Date();
        pushCardAudit(card, { by: null, action: 'contention-failed', note: `claim ${claim._id}: gave up after ${open.attempts} attempts` });
        continue;
      }

      try {
        const opts = client ? { client } : {};
        const result = await remapClaim(track, card, claim, open.text, opts);
        if (result.outcome === 'remapped') {
          Object.assign(claim, result.claim, {
            talentApproved: false, // the re-map goes back to the talent, always
            verdict: claim.verdict,
          });
        }
        open.outcome = result.outcome;
        open.response = result.explanation || (result.outcome === 'remapped' ? 'Re-mapped from your objection.' : '');
        open.respondedAt = new Date();
        pushCardAudit(card, {
          by: null,
          action: `contention-${result.outcome}`,
          note: `claim ${claim._id}`,
          after: { response: open.response },
        });
        outcomes.push({ cardId: card._id, claimId: claim._id, outcome: result.outcome });
      } catch (err) {
        open.attempts += 1; // retried next pass; capped above
        console.error('[structurer] contention re-map failed', err.message);
      }
    }
    await card.save();
  }
  return outcomes;
}

export async function structureOne(card, { client } = {}) {
  const track = await Track.findOne({ key: card.track });
  if (!track || !trackReadyForStructuring(track)) {
    // Not an error: structuring simply waits for the pack (or, in split
    // mode, the behavior spec). The card is safe in draft; no attempt is
    // burned.
    card.structuringError =
      track?.packMode === 'vocab-only' && track?.packText && !track?.behaviorSpecText
        ? 'awaiting-behavior-spec'
        : 'awaiting-pack';
    card.nextStructuringAttemptAt = new Date(Date.now() + 10 * 60_000);
    await card.save();
    return { outcome: 'awaiting-pack' };
  }

  try {
    // A2/A3: the CAPS memory scaffold rides along when the talent is
    // mapped and the project matches. Absent CAPS -> plain answers only.
    const talent = await User.findById(card.talentId);
    const capsScaffold = await taskScaffold(talent?.capsName, card.subject.name).catch(() => null);

    const opts = client ? { client, capsScaffold } : { capsScaffold };
    const { claims, followUps, signalsNoted, rejected } = await structureCard(track, card, opts);

    card.claims = claims;
    card.followUps = followUps;
    card.signalsNoted = signalsNoted ?? []; // A4: noted, never claimed, never a penalty
    card.packVersion = track.vocabPackVersion; // Invariant 1: the pack that structured it
    card.behaviorSpecVersion = track.behaviorSpecVersion ?? null; // A7: and the behavior spec, in split mode
    card.structuringError = null;
    card.nextStructuringAttemptAt = null;
    card.calibrationHold = false; // the hold is retired — JP spot-checks released cards instead
    pushCardAudit(card, {
      by: card.talentId,
      action: 'structured',
      after: { claims: claims.length, followUps: followUps.length, rejected: rejected.length, packVersion: track.vocabPackVersion },
      note: rejected.length ? `${rejected.length} claim(s) rejected by the validation layer` : null,
    });
    await transition(card, 'structured', card.talentId, 'structurer');
    await card.save();

    if (rejected.length) {
      await recordAudit({
        actorId: card.talentId,
        action: 'card.structuring-rejections',
        entity: 'card',
        entityId: card._id,
        after: { rejected: rejected.map((r) => r.reason) },
      });
    }
    return { outcome: 'structured', claims: claims.length, rejected: rejected.length };
  } catch (err) {
    // AC-8: raw intact, draft intact, retry scheduled.
    card.structuringAttempts += 1;
    card.structuringError = err instanceof StructuringError ? `${err.kind}: ${err.message}` : err.message;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (card.structuringAttempts - 1), 15 * 60_000);
    card.nextStructuringAttemptAt = new Date(Date.now() + backoff);
    pushCardAudit(card, {
      by: card.talentId,
      action: 'structuring-failed',
      note: card.structuringError,
    });
    await card.save();
    await recordAudit({
      actorId: card.talentId,
      action: 'card.structuring-failed',
      entity: 'card',
      entityId: card._id,
      after: { error: card.structuringError, attempt: card.structuringAttempts },
    });
    return { outcome: 'failed', error: card.structuringError };
  }
}
