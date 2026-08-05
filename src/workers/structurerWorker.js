/**
 * Structuring worker — picks up submitted drafts and structures them.
 *
 * Failure posture (Invariant 15 / AC-8): the card ALWAYS stays in draft
 * with raw answers intact when anything fails. Every failure is recorded
 * and retried with backoff; killing the process mid-structuring loses
 * nothing because claims + status move in one save after success.
 *
 * FR-11: when the track's calibration mode is on, freshly structured
 * cards hold for admin review (calibrationHold) before the talent sees
 * the claims. Mode exit is a JP-owned gate (Invariant 14) — nothing here
 * flips it.
 */

import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { structureCard, trackReadyForStructuring, StructuringError } from '../services/structurerService.js';
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
  } finally {
    running = false;
  }
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
    const opts = client ? { client } : {};
    const { claims, followUps, rejected } = await structureCard(track, card, opts);

    card.claims = claims;
    card.followUps = followUps;
    card.packVersion = track.vocabPackVersion; // Invariant 1: the pack that structured it
    card.behaviorSpecVersion = track.behaviorSpecVersion ?? null; // A7: and the behavior spec, in split mode
    card.structuringError = null;
    card.nextStructuringAttemptAt = null;
    card.calibrationHold = Boolean(track.calibrationMode); // FR-11
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
