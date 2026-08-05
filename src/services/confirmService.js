/**
 * Confirm & nominate & route (P4 — FR-12..FR-17).
 *
 * Invariants carried here:
 *  - 5: talent approves every claim before anything routes; partial
 *       approval routes only approved claims (unapproved claims cannot
 *       exist at routing time — the card only leaves the talent when
 *       every remaining claim is approved; removal is the talent's fix).
 *  - 4: leads select among the talent's nominees or reject with a
 *       reason. There is no code path that writes a lead-chosen nominee.
 *  - 6: talent fixes re-run the FR-10 validation layer and cannot
 *       inflate past the vocabulary.
 *  - 16: every permission is enforced here, server-side.
 */

import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { User } from '../models/User.js';
import { validateStructuredOutput } from './structurerService.js';
import { badRequest, forbidden, notFound, conflict } from '../utils/httpError.js';
import { pushCardAudit, recordAudit } from './auditService.js';
import { transition } from './statusMachine.js';

async function ownStructuredCard(actor, cardId, statuses = ['structured']) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.talentId.equals(actor._id)) throw forbidden('Only the card\'s talent can do this');
  if (!actor.hasRole('talent')) throw forbidden('Talent role required');
  if (!statuses.includes(card.status)) {
    throw conflict(`Card is not in a confirmable state (status "${card.status}")`);
  }
  if (card.calibrationHold) throw conflict('Card is still in calibration');
  return card;
}

// ---------------------------------------------------------------------------
// FR-12 — per-claim approve / fix
// ---------------------------------------------------------------------------

export async function decideClaim(actor, cardId, claimId, { action, labels, remove, statement, concessionReason } = {}) {
  const card = await ownStructuredCard(actor, cardId, ['structured', 'adjust']);
  const claim = card.claims.id(claimId);
  if (!claim) throw notFound('Claim not found');
  const before = claim.toObject();

  // Intent v2: concession costs more than defence — downgrading or
  // removing a DEFENDED claim requires a stated reason; the original
  // state stays side-by-side in the audit entry.
  const conceding = action === 'fix' && claim.defenseStatement;
  if (conceding && !concessionReason?.trim()) {
    throw badRequest('You defended this claim — changing it now needs a stated reason, on the record');
  }

  if (action === 'approve') {
    claim.talentApproved = true;
  } else if (action === 'defend') {
    // C1: the talent stands by an adjusted claim unchanged. The defence
    // goes on the record; if the reviewer holds Adjust again, the card
    // deadlocks and escalates to JP as non-partisan judge.
    if (card.status !== 'adjust' || claim.verdict !== 'Adjust') {
      throw conflict('Only a claim your reviewer adjusted can be defended');
    }
    if (!statement?.trim()) {
      throw badRequest('Say why the claim stands as written — your defence goes on the record');
    }
    claim.defenseStatement = statement.trim();
    claim.defendedAt = new Date();
    claim.talentApproved = true; // the defence re-affirms the claim as written
  } else if (action === 'fix') {
    if (remove) {
      // The talent's fix can be "this isn't mine" — the claim goes, audited.
      card.claims.pull(claimId);
    } else {
      const track = await Track.findOne({ key: card.track });
      const candidate = { ...before, labels: labels ?? before.labels };
      // Invariant 6: the fix re-runs the validation layer; off-vocabulary
      // values are rejected, and the quote stays the talent's words.
      const { claims, rejected } = validateStructuredOutput(track, card, {
        claims: [candidate],
        followUps: [],
      });
      if (!claims.length) {
        throw badRequest(`Fix rejected by the validation layer: ${rejected[0]?.reason ?? 'unknown'}`);
      }
      Object.assign(claim, claims[0], { talentApproved: true });
      if (conceding) {
        claim.concessionReason = concessionReason.trim();
        claim.defenseStatement = null; // conceded — a later Adjust is not a deadlock
        claim.defendedAt = null;
      }
    }
  } else {
    throw badRequest('action is approve, fix, or defend');
  }

  pushCardAudit(card, {
    by: actor._id,
    action: `claim-${remove ? 'removed' : action}`,
    before,
    after: remove ? null : card.claims.id(claimId)?.toObject(),
    note: conceding ? `concession after defence: ${concessionReason.trim()}` : null,
  });
  await card.save();
  await recordAudit({
    actorId: actor._id,
    action: `card.claim-${remove ? 'remove' : action}`,
    entity: 'card',
    entityId: card._id,
  });
  return card;
}

/** Answer a follow-up (FR-9's capture side of the answer). */
export async function answerFollowUp(actor, cardId, followUpId, answer) {
  const card = await ownStructuredCard(actor, cardId, ['structured', 'adjust']);
  const followUp = card.followUps.id(followUpId);
  if (!followUp) throw notFound('Follow-up not found');
  followUp.answer = String(answer ?? '');
  followUp.at = new Date();
  pushCardAudit(card, { by: actor._id, action: 'follow-up-answered' });
  await card.save();
  return card;
}

/** Invariant 5: full approval — every remaining claim approved — before routing. */
export async function approveCard(actor, cardId, { honestGap } = {}) {
  const card = await ownStructuredCard(actor, cardId);
  if (!card.claims.length) throw conflict('No claims to approve — nothing can route');
  const unapproved = card.claims.filter((c) => !c.talentApproved);
  if (unapproved.length) {
    throw conflict(`${unapproved.length} claim(s) still need your approve or fix`);
  }
  if (typeof honestGap === 'string' && honestGap.trim()) card.honestGap = honestGap;
  await transition(card, 'talent-approved', actor._id, 'talent approved every claim');
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.talent-approved', entity: 'card', entityId: card._id });
  return card;
}

// ---------------------------------------------------------------------------
// FR-13 — nomination with system checks
// ---------------------------------------------------------------------------

function cardText(card) {
  return [
    ...card.rawAnswers.map((a) => a.answer),
    ...card.sweepAnswers.map((s) => s.answer),
    ...card.claims.map((c) => `${c.sourceQuote} ${c.involvement ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * System checks (FR-13): (a) advocate block — the nominee is not the
 * lead, endorser, or a named call-maker on the card; (b) exposure —
 * verified when the nominee has a card on the same subject; otherwise
 * recorded as unverified for the lead, who owns exposure approval (P-2).
 * A failed hard check returns the pick to the talent with the reason.
 */
export async function runSystemChecks(actor, card, nomineeUsers) {
  const failures = [];
  const text = cardText(card);

  for (const nominee of nomineeUsers) {
    if (nominee._id.equals(actor._id)) {
      failures.push({ nominee: nominee.name, reason: 'You cannot nominate yourself' });
      continue;
    }
    if (actor.leadId && nominee._id.equals(actor.leadId)) {
      failures.push({ nominee: nominee.name, reason: 'Your Lead cannot be your confirmer (advocate block)' });
      continue;
    }
    const firstName = nominee.name.split(' ')[0].toLowerCase();
    if (firstName.length > 2 && text.includes(firstName)) {
      failures.push({
        nominee: nominee.name,
        reason: `${nominee.name} is named on the card as part of the work — a named call-maker cannot confirm it (advocate block)`,
      });
    }
  }

  const exposure = {};
  for (const nominee of nomineeUsers) {
    const attached = await Card.exists({
      talentId: nominee._id,
      'subject.name': card.subject.name,
    });
    exposure[nominee.name] = attached ? 'seen the work — checked' : 'not proven yet — your lead decides';
  }

  return { failures, exposure };
}

export async function submitNomination(actor, cardId, { nomineeIds = [], thinPool = false } = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.talentId.equals(actor._id)) throw forbidden('Only the card\'s talent can nominate');
  if (!actor.hasRole('talent')) throw forbidden('Talent role required');
  if (card.status !== 'talent-approved') {
    throw conflict(`Nomination happens after your approval (status "${card.status}")`);
  }

  if (thinPool) {
    // FR-15: no valid nominee exists — the track's fallback reviewer,
    // visibly marked as the exception path. Names are config (OD-2).
    const track = await Track.findOne({ key: card.track });
    if (!track.fallbackReviewerId) {
      throw conflict('No backup path is set up for this track yet — ask JP');
    }
    const fallback = await User.findById(track.fallbackReviewerId);
    card.nomination.nominees = [{ userId: fallback._id, name: fallback.name, role: 'fallback reviewer' }];
    card.nomination.thinPool = true;
    card.nomination.systemChecks = { advocateBlock: 'bypassed — thin pool', exposure: 'fallback reviewer' };
  } else {
    if (nomineeIds.length < 1 || nomineeIds.length > 2) throw badRequest('Nominate 1–2 confirmers');
    const nomineeUsers = await User.find({ _id: { $in: nomineeIds }, active: true });
    if (nomineeUsers.length !== nomineeIds.length) throw badRequest('Unknown nominee');

    const { failures, exposure } = await runSystemChecks(actor, card, nomineeUsers);
    if (failures.length) {
      // The pick returns to the talent with the reason — nothing routes.
      throw badRequest('A system check returned your pick', { failures });
    }
    card.nomination.nominees = nomineeUsers.map((u) => ({ userId: u._id, name: u.name, role: 'confirmer' }));
    card.nomination.thinPool = false;
    card.nomination.systemChecks = { advocateBlock: 'passed', exposure };
  }

  card.nomination.leadDecision = { action: null, reason: null, by: null, at: null };
  pushCardAudit(card, {
    by: actor._id,
    action: 'nomination-submitted',
    after: { nominees: card.nomination.nominees.map((n) => n.name), thinPool: card.nomination.thinPool },
  });
  await transition(card, 'lead-nominee-review', actor._id);
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.nomination-submitted', entity: 'card', entityId: card._id });
  return card;
}

/** Eligible nominees for the picker: active users, minus self and own lead. */
export async function nomineeCandidates(actor) {
  const query = { active: true, _id: { $ne: actor._id } };
  if (actor.leadId) query._id = { $nin: [actor._id, actor.leadId] };
  return User.find(query, { name: 1, track: 1, roles: 1 }).sort({ name: 1 });
}

// ---------------------------------------------------------------------------
// FR-14 / FR-17 — lead decision with repeat-reviewer prompt
// ---------------------------------------------------------------------------

/** FR-17: consecutive prior cards of this talent routed to this reviewer. */
export async function repeatStreakFor(talentId, reviewerId) {
  const prior = await Card.find(
    { talentId, 'nomination.routedTo': { $ne: null }, status: { $in: ['routed', 'confirmed', 'adjust', 'revised', 'archived'] } },
    { 'nomination.routedTo': 1, updatedAt: 1 },
  )
    .sort({ updatedAt: -1 })
    .limit(10);
  let streak = 0;
  for (const card of prior) {
    if (card.nomination.routedTo.equals(reviewerId)) streak += 1;
    else break;
  }
  return streak;
}

export async function leadNomineeQueue(actor) {
  if (!actor.hasRole('lead')) throw forbidden('Lead role required');
  const reports = await User.find({ leadId: actor._id, active: true }, { _id: 1, name: 1 });
  const cards = await Card.find({
    talentId: { $in: reports.map((r) => r._id) },
    status: 'lead-nominee-review',
  }).sort({ updatedAt: 1 });

  const names = Object.fromEntries(reports.map((r) => [r._id.toString(), r.name]));
  return Promise.all(
    cards.map(async (card) => {
      const streaks = {};
      for (const nominee of card.nomination.nominees) {
        streaks[nominee.name] = await repeatStreakFor(card.talentId, nominee.userId);
      }
      const obj = card.toObject();
      obj.talentName = names[card.talentId.toString()];
      obj.repeatStreaks = streaks; // FR-17: 3rd consecutive time surfaces a rotation prompt
      return obj;
    }),
  );
}

/**
 * FR-14: approve (selecting ONE of the talent's nominees) or reject with
 * a required reason. Selection is not substitution — the choice set is
 * exactly what the talent tagged (Invariant 4).
 */
export async function decideNomination(actor, cardId, { action, reason = null, approvedNomineeId = null }) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!actor.hasRole('lead')) throw forbidden('Only a lead can decide on nominees');
  const talent = await User.findById(card.talentId);
  if (!talent?.leadId?.equals?.(actor._id)) throw forbidden('You can only decide for your own reports');
  if (card.status !== 'lead-nominee-review') {
    throw conflict(`Card is not awaiting your decision (status "${card.status}")`);
  }

  if (action === 'reject') {
    if (!reason?.trim()) throw badRequest('A rejection requires a stated reason — it returns the pick to the talent');
    card.nomination.leadDecision = { action: 'reject', reason, by: actor._id, at: new Date() };
    pushCardAudit(card, { by: actor._id, action: 'nominee-reject', note: reason });
    await transition(card, 'talent-approved', actor._id, 'nominee rejected — pick returns to the talent');
    await card.save();
    await recordAudit({ actorId: actor._id, action: 'card.nominee-reject', entity: 'card', entityId: card._id, after: { reason } });
    return card;
  }

  if (action !== 'approve') throw badRequest('Decision is approve or reject');
  const chosen = card.nomination.nominees.find((n) => n.userId.toString() === String(approvedNomineeId));
  if (!chosen) throw badRequest('The approved confirmer must be one of the talent\'s nominees'); // Invariant 4

  card.nomination.leadDecision = { action: 'approve', reason, by: actor._id, at: new Date() };
  card.nomination.routedTo = chosen.userId;
  card.nomination.routedAt = new Date(); // A5: the SLA clock starts here
  card.nomination.repeatStreak = (await repeatStreakFor(card.talentId, chosen.userId)) + 1;
  pushCardAudit(card, { by: actor._id, action: 'nominee-approve', note: `routed to ${chosen.name}` });
  await transition(card, 'routed', actor._id, `routed to ${chosen.name}`);
  await card.save();
  await recordAudit({
    actorId: actor._id, action: 'card.nominee-approve', entity: 'card', entityId: card._id,
    after: { routedTo: chosen.name, repeatStreak: card.nomination.repeatStreak },
  });
  return card;
}

// ---------------------------------------------------------------------------
// FR-16 — the adjust → revise → re-route leg
// ---------------------------------------------------------------------------

export async function rerouteAfterRevision(actor, cardId) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.talentId.equals(actor._id)) throw forbidden('Only the card\'s talent can send it back');
  if (!actor.hasRole('talent')) throw forbidden('Talent role required');
  if (card.status !== 'adjust') throw conflict(`Card is not awaiting revision (status "${card.status}")`);

  const stillAdjust = card.claims.filter((c) => c.verdict === 'Adjust' && !c.talentApproved);
  if (stillAdjust.length) {
    throw conflict(`${stillAdjust.length} adjusted claim(s) still need your fix or approve`);
  }

  // BR-7: Adjust requires revision and re-review — cleared verdicts go
  // back to the same reviewer; Confirmed verdicts stand. A defence
  // (C1) stays on the claim: if the reviewer holds Adjust on it again,
  // the card deadlocks.
  for (const claim of card.claims) {
    if (claim.verdict === 'Adjust') {
      claim.verdict = null;
      claim.verdictNote = null;
      claim.verdictBy = null;
      claim.verdictAt = null;
    }
  }
  card.nomination.routedAt = new Date(); // A5: the SLA clock restarts on re-route
  await transition(card, 'revised', actor._id, 'talent revised after Adjust');
  await transition(card, 'routed', actor._id, 're-routed to the same reviewer');
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.reroute-after-revision', entity: 'card', entityId: card._id });
  return card;
}
