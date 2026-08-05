/**
 * B2 — verdict-adjacent mechanics (Amendment 1 §A5 + Ruling C1).
 *
 * NOTHING here writes a verdict. Invariant 3 is untouched and absolute:
 * the verdict field is writable only by the card's assigned non-advocate
 * (cardService.applyVerdict). This module carries what happens AROUND
 * verdicts:
 *
 *  - JP's ruling on a deadlocked card — guidance on the record, never a
 *    verdict. The assigned reviewer re-reviews with it in view and
 *    writes the verdict themselves, or refuses.
 *  - Refusal → auto-reassignment to the track's fallback reviewer (the
 *    OD-2 admin setting, read at escalation time, never snapshotted),
 *    with the exclusion rule: never the talent, a nominee, or a party
 *    to the deadlock. Unset/excluded → the escalation HALTS and
 *    surfaces on JP's dashboard; nothing guesses a reviewer.
 *  - The A5 SLA escalation shares the same fallback resolution.
 *  - The JP pending-verdict dashboard (counts and statuses only —
 *    Invariant 12) and manual nudges.
 *  - The C9 hook: "Confirmed — packaging deferred" (Endorsement Review
 *    runs manually; the confirmed level is recorded, never erased).
 */

import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { User } from '../models/User.js';
import { badRequest, forbidden, notFound, conflict } from '../utils/httpError.js';
import { workingDaysBetween } from '../utils/workingDays.js';
import { pushCardAudit, recordAudit } from './auditService.js';
import { transition } from './statusMachine.js';
import { repeatStreakFor } from './confirmService.js';

// ---------------------------------------------------------------------------
// C1 — ruling, refusal, reassignment
// ---------------------------------------------------------------------------

/** JP writes a ruling on a deadlocked card. Guidance, never a verdict. */
export async function writeRuling(actor, cardId, text) {
  if (!actor.hasRole('admin')) throw forbidden('Only JP writes rulings');
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (card.status !== 'deadlocked') {
    throw conflict(`A ruling answers a deadlock (status "${card.status}")`);
  }
  if (!text?.trim()) throw badRequest('A ruling needs its text');

  card.ruling = { text: text.trim(), by: actor._id, at: new Date() };
  pushCardAudit(card, {
    by: actor._id,
    action: 'ruling',
    after: { text: card.ruling.text },
    note: 'a ruling is guidance on the record, not a verdict (C1; Invariant 3 untouched)',
  });
  await transition(card, 'ruled', actor._id, 'JP ruled — the assigned reviewer re-reviews with the ruling in view');
  await card.save();
  await recordAudit({
    actorId: actor._id, action: 'card.ruling', entity: 'card', entityId: card._id,
    after: { text: card.ruling.text },
  });
  return card;
}

/**
 * The assigned reviewer, after the ruling, still refuses to write a
 * verdict. Their final position is logged permanently; the card
 * auto-reassigns to the fallback reviewer, who reviews fresh.
 */
export async function refuseAfterRuling(actor, cardId, statement) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.nomination?.routedTo?.equals?.(actor._id)) {
    throw forbidden('Only the card\'s assigned reviewer can refuse');
  }
  if (card.status !== 'ruled') throw conflict(`Refusal answers a ruling (status "${card.status}")`);
  if (!statement?.trim()) {
    throw badRequest('State your final position — it goes on the record permanently');
  }

  pushCardAudit(card, {
    by: actor._id,
    action: 'reviewer-refused-after-ruling',
    after: { finalPosition: statement.trim() },
    note: 'logged permanently (C1)',
  });

  // The fallback reviews FRESH: contested verdicts clear (both final
  // positions already live permanently in the audit trail).
  const cleared = [];
  for (const claim of card.claims) {
    if (claim.verdict !== null) {
      cleared.push({ claim: claim.competencyOrDomain, verdict: claim.verdict, note: claim.verdictNote });
      claim.verdict = null;
      claim.verdictNote = null;
      claim.verdictBy = null;
      claim.verdictAt = null;
    }
  }
  if (cleared.length) {
    pushCardAudit(card, { by: actor._id, action: 'verdicts-cleared-for-reassignment', after: { cleared } });
  }

  return escalateToFallback(card, 'refused-after-ruling', actor._id);
}

/**
 * Shared escalation: resolve the track's fallback reviewer AT THIS
 * MOMENT (OD-2: the setting, not a snapshot), apply the exclusion rule,
 * and either reassign or halt visibly.
 */
export async function escalateToFallback(card, kind, actorId = null) {
  const track = await Track.findOne({ key: card.track });
  const fallbackId = track?.fallbackReviewerId ?? null;
  const fallback = fallbackId ? await User.findById(fallbackId) : null;

  const excludedBecause = !fallback || !fallback.active
    ? 'no one is set to take over on this track yet — set it under Tracks'
    : fallback._id.equals(card.talentId)
      ? 'the person set to take over is this card\'s talent'
      : card.nomination.routedTo?.equals?.(fallback._id)
        ? 'the person set to take over is already one side of this disagreement'
        : card.nomination.nominees.some((n) => n.userId?.equals?.(fallback._id))
          ? 'the person set to take over is the talent\'s pick on this card'
          : null;

  if (excludedBecause) {
    // Halt, visibly. Nothing guesses a reviewer; JP resolves manually.
    card.nomination.escalationHalted = { reason: excludedBecause, at: new Date() };
    pushCardAudit(card, { by: actorId, action: 'escalation-halted', note: excludedBecause });
    await card.save();
    await recordAudit({
      actorId, action: 'card.escalation-halted', entity: 'card', entityId: card._id,
      after: { reason: excludedBecause, kind },
    });
    return card;
  }

  card.nomination.reassignedFrom = card.nomination.routedTo;
  card.nomination.routedTo = fallback._id;
  card.nomination.reassignedAt = new Date(); // A5: the SLA clock restarts
  card.nomination.escalated = kind;
  card.nomination.escalationHalted = null;
  pushCardAudit(card, {
    by: actorId,
    action: 'reassigned-to-fallback',
    after: { routedTo: fallback.name, kind },
    note: 'non-response is never a verdict — the fallback reviewer writes it (A5/C1)',
  });
  await transition(card, 'reassigned', actorId, `reassigned to fallback reviewer ${fallback.name} (${kind})`);
  await card.save();
  await recordAudit({
    actorId, action: 'card.reassigned', entity: 'card', entityId: card._id,
    after: { routedTo: fallback.name, kind },
  });
  return card;
}

// ---------------------------------------------------------------------------
// A5 — JP dashboard + manual nudge
// ---------------------------------------------------------------------------

const PENDING_STATUSES = ['routed', 'deadlocked', 'ruled', 'reassigned'];

/** Every card pending a verdict: nominee, aging, chases. Counts only — no ranking. */
export async function pendingVerdicts(actor, { now = new Date() } = {}) {
  if (!actor.hasRole('admin')) throw forbidden('Admin only');
  const cards = await Card.find({ status: { $in: PENDING_STATUSES } }).sort({ updatedAt: 1 });
  const userIds = new Set();
  for (const card of cards) {
    userIds.add(card.talentId.toString());
    if (card.nomination?.routedTo) userIds.add(card.nomination.routedTo.toString());
  }
  const users = await User.find({ _id: { $in: [...userIds] } }, { name: 1 });
  const names = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

  return Promise.all(
    cards.map(async (card) => ({
      _id: card._id,
      subject: card.subject,
      track: card.track,
      status: card.status,
      talentName: names[card.talentId.toString()] ?? '—',
      reviewerName: card.nomination?.routedTo ? names[card.nomination.routedTo.toString()] ?? '—' : '—',
      agingWorkingDays: workingDaysBetween(
        card.nomination?.reassignedAt || card.nomination?.routedAt || card.updatedAt,
        now,
      ),
      chases: card.nomination?.chases?.length ?? 0,
      repeatStreak: card.nomination?.routedTo
        ? await repeatStreakFor(card.talentId, card.nomination.routedTo)
        : 0,
      escalated: card.nomination?.escalated ?? null,
      escalationHalted: card.nomination?.escalationHalted ?? null,
      deadlockedAt: card.deadlockedAt,
      hasRuling: Boolean(card.ruling),
      undecidedClaims: card.claims.filter((c) => c.verdict === null).length,
    })),
  );
}

/** JP nudges manually, any time (A5). Recorded like a chase. */
export async function nudge(actor, cardId) {
  if (!actor.hasRole('admin')) throw forbidden('Admin only');
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!PENDING_STATUSES.includes(card.status)) {
    throw conflict(`Nothing to nudge (status "${card.status}")`);
  }
  card.nomination.chases.push({ kind: 'manual-nudge', by: actor._id, at: new Date() });
  pushCardAudit(card, { by: actor._id, action: 'manual-nudge' });
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.manual-nudge', entity: 'card', entityId: card._id });
  return card;
}

// ---------------------------------------------------------------------------
// C9 hook — "Confirmed — packaging deferred"
// ---------------------------------------------------------------------------

export async function deferPackaging(actor, cardId) {
  if (!actor.hasRole('admin')) throw forbidden('Admin only');
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (card.status !== 'confirmed') {
    throw conflict('Packaging deferral marks a CONFIRMED card — the level is already on record');
  }
  card.packagingDeferredBy = actor._id;
  card.packagingDeferredAt = new Date();
  pushCardAudit(card, {
    by: actor._id,
    action: 'packaging-deferred',
    note: 'Endorsement Review deferred packaging; the confirmed level stays recorded, never erased (A5/C9)',
  });
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.packaging-deferred', entity: 'card', entityId: card._id });
  return card;
}
