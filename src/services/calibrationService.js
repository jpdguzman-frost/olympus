/**
 * Spot-check review (JP, Aug 6 — replaces the FR-11 calibration HOLD).
 * Structured cards go straight to the talent; JP reviews released cards
 * on his own time instead of gating them. Corrections are logged with
 * before/after; edits re-run the FR-10 validation layer, so even JP
 * cannot write an off-vocabulary label.
 *
 * THE FIX WINDOW (JP's ruling, Aug 6):
 *  - Before the talent sends: JP edits freely; the talent simply sees
 *    the corrected line when they read the card.
 *  - After send, before it reaches a checker (exposure sign-off wait):
 *    an edit PULLS THE LINE BACK — its approval clears, its checker slot
 *    empties, and the talent re-looks and re-sends (a checker never
 *    judges text the talent didn't approve).
 *  - Once routed: log-only. The correction is recorded as calibration
 *    input (Pack §E) and touches nothing on the card.
 *
 * Calibration-mode EXIT is still GATE-1, JP-owned (Invariant 14).
 */

import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { validateStructuredOutput } from './structurerService.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { pushCardAudit, recordAudit } from './auditService.js';

/** Free-edit + pull-back statuses. Anything past these is log-only. */
const FIX_WINDOW_STATUSES = ['structured', 'talent-approved', 'exposure-signoff'];
const SENT_STATUSES = ['talent-approved', 'exposure-signoff'];

/**
 * The spot-check list: released write-ups JP can still fix (newest
 * first), each marked with how far along it is.
 */
export async function listSpotCheck() {
  const cards = await Card.find({
    status: { $in: FIX_WINDOW_STATUSES },
    'claims.0': { $exists: true },
  }).sort({ updatedAt: -1 });
  return cards;
}

/**
 * Edit or remove one claim; every correction is audited and counted.
 * Behavior depends on where the card sits in the fix window (above).
 * Returns { card, logOnly, pulledBack }.
 */
export async function correctClaim(actor, cardId, claimId, { action, ...fields }) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  const claim = card.claims.id(claimId);
  if (!claim) throw notFound('Claim not found');
  const before = claim.toObject();

  // Past the fix window: the correction is calibration input only —
  // recorded, counted, never applied (the checker is already judging
  // the text the talent approved).
  if (!FIX_WINDOW_STATUSES.includes(card.status)) {
    pushCardAudit(card, {
      by: actor._id,
      action: 'calibration-note',
      before,
      after: fields,
      note: `fix window closed (status "${card.status}") — logged as calibration input only, nothing changed on the card`,
    });
    await card.save();
    await recordAudit({
      actorId: actor._id,
      action: 'card.calibration-note',
      entity: 'card',
      entityId: card._id,
      before,
      after: { proposed: fields, applied: false },
    });
    return { card, logOnly: true, pulledBack: false };
  }

  if (action === 'remove') {
    card.claims.pull(claimId);
  } else if (action === 'edit') {
    const track = await Track.findOne({ key: card.track });
    const candidate = {
      type: fields.type ?? claim.type,
      competencyOrDomain: fields.competencyOrDomain ?? claim.competencyOrDomain,
      labels: fields.labels ?? claim.labels,
      sourceQuote: claim.sourceQuote, // the quote is the talent's words — not editable
      involvement: fields.involvement ?? claim.involvement,
      countAfterMe: fields.countAfterMe ?? claim.countAfterMe,
      flags: fields.flags ?? claim.flags,
      anchor: claim.anchorText ?? '', // the anchor rides through unchanged
      rationale: fields.rationale ?? claim.rationale ?? '',
      missingPiece: claim.missingPiece ?? '',
    };
    // FR-10 applies to corrections too — fails closed.
    const { claims, rejected } = validateStructuredOutput(track, card, { claims: [candidate], followUps: [] });
    if (!claims.length) {
      throw badRequest(`Correction rejected by the validation layer: ${rejected[0]?.reason ?? 'unknown'}`);
    }
    Object.assign(claim, claims[0], { anchorSource: before.anchorSource });
  } else {
    throw badRequest('action is edit or remove');
  }
  card.calibrationCorrections += 1; // GATE-1: this card is no longer clean

  // The pull-back: the talent approved this line at send, and it hasn't
  // reached a checker yet — a changed line goes back for their re-look.
  let pulledBack = false;
  if (SENT_STATUSES.includes(card.status) && before.talentApproved && action !== 'remove') {
    claim.talentApproved = false;
    claim.checkerId = null;
    claim.needsRelook = true;
    pulledBack = true;
  }

  pushCardAudit(card, {
    by: actor._id,
    action: `calibration-${action}`,
    before,
    after: action === 'remove' ? null : card.claims.id(claimId)?.toObject(),
    note: pulledBack ? 'the line goes back to the talent for a re-look before any checker sees it' : null,
  });
  await card.save();
  await recordAudit({
    actorId: actor._id,
    action: `card.calibration-${action}`,
    entity: 'card',
    entityId: card._id,
    before,
    after: action === 'remove' ? null : fields,
  });
  return { card, logOnly: false, pulledBack };
}

/**
 * GATE-1 progress (AC-9): consecutive cards that reached a checker with
 * ZERO spot-check corrections, newest backwards, per track — plus how
 * many distinct talents that streak covers. The exit bar is 5 clean
 * across 3 talents; the DECISION stays JP's (Invariant 14) — this only
 * counts. (A card counts once it is past the fix window: routed or
 * beyond, so its correction count is final.)
 */
export async function cleanStreaks() {
  const tracks = await Track.find({}, { key: 1, label: 1, calibrationMode: 1 });
  const result = [];
  for (const track of tracks) {
    const past = await Card.find(
      {
        track: track.key,
        status: { $in: ['routed', 'adjust', 'revised', 'deadlocked', 'ruled', 'reassigned', 'confirmed', 'archived'] },
        'claims.0': { $exists: true },
      },
      { calibrationCorrections: 1, talentId: 1, updatedAt: 1 },
    ).sort({ updatedAt: -1 }).limit(25);
    let streak = 0;
    const talents = new Set();
    for (const card of past) {
      if ((card.calibrationCorrections ?? 0) > 0) break;
      streak += 1;
      talents.add(card.talentId.toString());
    }
    result.push({
      track: track.key,
      label: track.label,
      calibrationMode: track.calibrationMode,
      cleanStreak: streak,
      distinctTalents: talents.size,
    });
  }
  return result;
}

/**
 * The correction log (Pack §D/§E): every spot-check fix — applied or
 * log-only — newest first. Each one is a permanent regression case and
 * behavior-spec input; the AI learns ONLY through JP folding these into
 * a published behavior-spec version, never by itself.
 */
export async function correctionLog({ limit = 50 } = {}) {
  const { AuditLog } = await import('../models/AuditLog.js');
  const entries = await AuditLog.find({
    action: { $in: ['card.calibration-edit', 'card.calibration-remove', 'card.calibration-note'] },
  }).sort({ createdAt: -1 }).limit(limit);

  const cardIds = [...new Set(entries.map((e) => e.entityId?.toString()).filter(Boolean))];
  const cards = await Card.find({ _id: { $in: cardIds } }, { 'subject.name': 1, track: 1 });
  const names = Object.fromEntries(cards.map((c) => [c._id.toString(), c.subject.name]));

  return entries.map((e) => ({
    at: e.createdAt,
    action: e.action.replace('card.calibration-', ''),
    cardSubject: names[e.entityId?.toString()] ?? '—',
    before: e.before,
    after: e.after,
  }));
}
