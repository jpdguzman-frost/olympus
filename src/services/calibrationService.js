/**
 * Calibration review (FR-11) — admin-only actions on structured cards
 * held in calibration. Corrections are logged with before/after; edits
 * re-run the FR-10 validation layer, so even JP cannot write an
 * off-vocabulary label. Releasing a card makes its claims visible to the
 * talent. Calibration-mode EXIT is GATE-1, JP-owned (Invariant 14) —
 * the mode toggle lives with the admin, never with the agent.
 */

import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { validateStructuredOutput } from './structurerService.js';
import { badRequest, notFound, conflict } from '../utils/httpError.js';
import { pushCardAudit, recordAudit } from './auditService.js';

export function listCalibrationQueue() {
  return Card.find({ status: 'structured', calibrationHold: true }).sort({ updatedAt: 1 });
}

async function getHeldCard(cardId) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.calibrationHold) throw conflict('Card is not in calibration');
  return card;
}

/** Edit or remove one claim; every correction is audited (FR-11). */
export async function correctClaim(actor, cardId, claimId, { action, ...fields }) {
  const card = await getHeldCard(cardId);
  const claim = card.claims.id(claimId);
  if (!claim) throw notFound('Claim not found');
  const before = claim.toObject();

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

  pushCardAudit(card, {
    by: actor._id,
    action: `calibration-${action}`,
    before,
    after: action === 'remove' ? null : card.claims.id(claimId)?.toObject(),
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
  return card;
}

/**
 * GATE-1 progress (AC-9): consecutive RELEASED cards with zero
 * corrections, newest backwards, per track — plus how many distinct
 * talents that streak covers. The exit bar is 5 clean across 3
 * talents; the DECISION stays JP's (Invariant 14) — this only counts.
 */
export async function cleanStreaks() {
  const tracks = await Track.find({}, { key: 1, label: 1, calibrationMode: 1 });
  const result = [];
  for (const track of tracks) {
    const released = await Card.find(
      { track: track.key, calibrationReleasedAt: { $ne: null } },
      { calibrationCorrections: 1, talentId: 1, calibrationReleasedAt: 1 },
    ).sort({ calibrationReleasedAt: -1 }).limit(25);
    let streak = 0;
    const talents = new Set();
    for (const card of released) {
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
 * The correction log (Pack §D/§E): every calibration fix, newest first —
 * each one is a permanent regression case and behavior-spec input.
 */
export async function correctionLog({ limit = 50 } = {}) {
  const { AuditLog } = await import('../models/AuditLog.js');
  const entries = await AuditLog.find({
    action: { $in: ['card.calibration-edit', 'card.calibration-remove'] },
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

/** Release: the talent can now see the structured claims. */
export async function releaseCard(actor, cardId) {
  const card = await getHeldCard(cardId);
  card.calibrationHold = false;
  card.calibrationReleasedBy = actor._id;
  card.calibrationReleasedAt = new Date();
  pushCardAudit(card, { by: actor._id, action: 'calibration-release' });
  await card.save();
  await recordAudit({
    actorId: actor._id,
    action: 'card.calibration-release',
    entity: 'card',
    entityId: card._id,
  });
  return card;
}
