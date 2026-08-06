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
  const isReviewer =
    (card.nomination?.routedTo?.equals?.(actor._id) ?? false) ||
    (card.nomination?.routes || []).some((r) => r.reviewerId?.equals?.(actor._id));
  if (!isReviewer) {
    throw forbidden('Only an assigned checker on this card can refuse');
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

  // The fallback reviews FRESH: the refusing checker's verdicts clear
  // (both final positions already live permanently in the audit trail).
  // C2v2: ONLY their lines clear — another checker's Confirmed lines
  // stand untouched. The cleared lines stay talent-approved — they were
  // routed on the talent's approval, and the defence stands on the record.
  const cleared = [];
  for (const claim of card.claims) {
    const theirs = claim.checkerId ? claim.checkerId.equals(actor._id) : true;
    if (theirs && claim.verdict !== null) {
      cleared.push({ claim: claim.competencyOrDomain, verdict: claim.verdict, note: claim.verdictNote });
      claim.verdict = null;
      claim.verdictNote = null;
      claim.verdictBy = null;
      claim.verdictAt = null;
      claim.talentApproved = true;
    }
  }
  if (cleared.length) {
    pushCardAudit(card, { by: actor._id, action: 'verdicts-cleared-for-reassignment', after: { cleared } });
  }

  return escalateRoute(card, actor._id, 'refused-after-ruling', actor._id);
}

/**
 * Shared escalation, PER ROUTE (C2v2): resolve the track's fallback
 * reviewer AT THIS MOMENT (OD-2: the setting, not a snapshot), apply
 * the exclusion rule, and either reassign that route or halt visibly.
 */
export async function escalateRoute(card, fromReviewerId, kind, actorId = null) {
  const track = await Track.findOne({ key: card.track });
  const fallbackId = track?.fallbackReviewerId ?? null;
  const fallback = fallbackId ? await User.findById(fallbackId) : null;
  const route = (card.nomination.routes || []).find((r) => r.reviewerId?.equals?.(fromReviewerId)) ?? null;

  const excludedBecause = !fallback || !fallback.active
    ? 'no one is set to take over on this track yet — set it under Tracks'
    : fallback._id.equals(card.talentId)
      ? 'the person set to take over is this card\'s talent'
      : fallback._id.equals(fromReviewerId) || card.nomination.routedTo?.equals?.(fallback._id)
        ? 'the person set to take over is already one side of this disagreement'
        : card.nomination.nominees.some((n) => n.userId?.equals?.(fallback._id)) ||
            (card.nomination.routes || []).some((r) => r.reviewerId?.equals?.(fallback._id))
          ? 'the person set to take over is the talent\'s pick on this card'
          : null;

  if (excludedBecause) {
    // Halt, visibly. Nothing guesses a reviewer; JP resolves manually.
    const halted = { reason: excludedBecause, at: new Date() };
    if (route) route.escalationHalted = halted;
    else card.nomination.escalationHalted = halted;
    pushCardAudit(card, { by: actorId, action: 'escalation-halted', note: excludedBecause });
    await card.save();
    await recordAudit({
      actorId, action: 'card.escalation-halted', entity: 'card', entityId: card._id,
      after: { reason: excludedBecause, kind },
    });
    return card;
  }

  const now = new Date();
  if (route) {
    // C2v2: the route hands over; the checker's undecided lines move to
    // the fallback. Lines another checker already decided are untouched.
    route.reassignedFrom = route.reviewerId;
    route.reviewerId = fallback._id;
    route.name = fallback.name;
    route.reassignedAt = now; // A5: this route's SLA clock restarts
    route.escalated = kind;
    route.escalationHalted = null;
    for (const claim of card.claims) {
      if (claim.checkerId?.equals?.(fromReviewerId) && claim.verdict === null) {
        claim.checkerId = fallback._id;
      }
    }
  } else {
    card.nomination.reassignedFrom = card.nomination.routedTo;
    card.nomination.routedTo = fallback._id;
    card.nomination.reassignedAt = now;
    card.nomination.escalated = kind;
    card.nomination.escalationHalted = null;
  }
  pushCardAudit(card, {
    by: actorId,
    action: 'reassigned-to-fallback',
    after: { routedTo: fallback.name, kind },
    note: 'non-response is never a verdict — the fallback reviewer writes it (A5/C1)',
  });
  if (card.status !== 'reassigned') {
    await transition(card, 'reassigned', actorId, `reassigned to fallback reviewer ${fallback.name} (${kind})`);
  }
  await card.save();
  await recordAudit({
    actorId, action: 'card.reassigned', entity: 'card', entityId: card._id,
    after: { routedTo: fallback.name, kind },
  });
  return card;
}

/** Legacy entry (pre-C2v2 single-route cards and older tests). */
export function escalateToFallback(card, kind, actorId = null) {
  const from = card.nomination.routes?.[0]?.reviewerId ?? card.nomination.routedTo;
  return escalateRoute(card, from, kind, actorId);
}

// ---------------------------------------------------------------------------
// A5 — JP dashboard + manual nudge
// ---------------------------------------------------------------------------

const PENDING_STATUSES = ['routed', 'deadlocked', 'ruled', 'reassigned'];

/**
 * Every route pending a verdict (C2v2: one row PER ROUTE — a card with
 * two checkers shows two rows, each with its own clock and chases).
 * Counts and statuses only — no ranking (Invariant 12).
 */
export async function pendingVerdicts(actor, { now = new Date() } = {}) {
  if (!actor.hasRole('admin')) throw forbidden('Admin only');
  const cards = await Card.find({ status: { $in: PENDING_STATUSES } }).sort({ updatedAt: 1 });
  const userIds = new Set();
  for (const card of cards) {
    userIds.add(card.talentId.toString());
    if (card.nomination?.routedTo) userIds.add(card.nomination.routedTo.toString());
    for (const r of card.nomination?.routes || []) userIds.add(r.reviewerId.toString());
  }
  const users = await User.find({ _id: { $in: [...userIds] } }, { name: 1 });
  const names = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

  const rows = [];
  for (const card of cards) {
    const routes = card.nomination?.routes?.length
      ? card.nomination.routes
      : [
          {
            reviewerId: card.nomination?.routedTo ?? null,
            name: card.nomination?.routedTo ? names[card.nomination.routedTo.toString()] ?? '—' : '—',
            routedAt: card.nomination?.routedAt,
            reassignedAt: card.nomination?.reassignedAt,
            chases: card.nomination?.chases ?? [],
            escalated: card.nomination?.escalated ?? null,
            escalationHalted: card.nomination?.escalationHalted ?? null,
            repeatStreak: card.nomination?.repeatStreak ?? 0,
          },
        ];
    for (const route of routes) {
      const theirLines = card.claims.filter((c) =>
        c.checkerId ? c.checkerId.equals(route.reviewerId) : c.talentApproved || c.verdict,
      );
      const undecided = theirLines.filter((c) => (c.talentApproved || c.verdict) && c.verdict === null).length;
      // Only rows that still need something: undecided lines, a live
      // deadlock/ruling, or a halted escalation.
      if (!undecided && !route.escalationHalted && !['deadlocked', 'ruled'].includes(card.status)) continue;
      rows.push({
        _id: card._id,
        reviewerId: route.reviewerId,
        subject: card.subject,
        track: card.track,
        status: card.status,
        talentName: names[card.talentId.toString()] ?? '—',
        reviewerName: route.name || (route.reviewerId ? names[route.reviewerId.toString()] ?? '—' : '—'),
        agingWorkingDays: workingDaysBetween(route.reassignedAt || route.routedAt || card.updatedAt, now),
        chases: route.chases?.length ?? 0,
        repeatStreak: route.repeatStreak ?? 0,
        escalated: route.escalated ?? null,
        escalationHalted: route.escalationHalted ?? null,
        deadlockedAt: card.deadlockedAt,
        hasRuling: Boolean(card.ruling),
        undecidedClaims: undecided,
      });
    }
  }
  return rows;
}

/** JP nudges manually, any time (A5). Recorded like a chase, per route. */
export async function nudge(actor, cardId, reviewerId = null) {
  if (!actor.hasRole('admin')) throw forbidden('Admin only');
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!PENDING_STATUSES.includes(card.status)) {
    throw conflict(`Nothing to nudge (status "${card.status}")`);
  }
  const routes = card.nomination.routes || [];
  const route = reviewerId
    ? routes.find((r) => String(r.reviewerId) === String(reviewerId))
    : routes.length === 1
      ? routes[0]
      : null;
  if (route) route.chases.push({ kind: 'manual-nudge', by: actor._id, at: new Date() });
  else card.nomination.chases.push({ kind: 'manual-nudge', by: actor._id, at: new Date() });
  pushCardAudit(card, { by: actor._id, action: 'manual-nudge', after: route ? { pick: route.name } : null });
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
