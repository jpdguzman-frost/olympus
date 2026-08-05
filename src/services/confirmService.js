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

  // A4 date anchoring: nothing gets approved without account + date or
  // period. The talent adds it in their own words; the line is never
  // blocked, it just stays draft — "needs a date".
  const approving = ['approve', 'defend'].includes(action) || (action === 'fix' && !remove);
  if (approving && !claim.anchorText) {
    throw badRequest('This line needs a date first — say when this was and where (e.g. "JFC, April to June 2026")');
  }

  if (action === 'anchor') {
    const text = statement; // the talent's own words: account + date/period
    if (!text?.trim()) throw badRequest('Say when this was and where — e.g. "JFC, April to June 2026"');
    claim.anchorText = text.trim();
    claim.anchorSource = 'talent';
  } else if (action === 'contest') {
    // A4 contention loop: the talent points at the traceback and says
    // what's wrong. The AI re-maps or explains within a minute; the
    // answer always comes back to the talent. Never final over their
    // objection.
    const text = statement;
    if (!text?.trim()) throw badRequest('Point at your words and say what\'s wrong with the mapping');
    const open = (claim.contentions || []).find((c) => c.outcome === null);
    if (open) throw conflict('This line is already being re-checked — the answer lands here shortly');
    claim.contentions.push({ text: text.trim(), at: new Date(), outcome: null });
    claim.talentApproved = false;
  } else if (action === 'approve') {
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
      // anchor rides through the re-validation unchanged (raw.anchor is
      // what the validator reads back into anchorText).
      const candidate = { ...before, labels: labels ?? before.labels, anchor: before.anchorText ?? '' };
      // Invariant 6: the fix re-runs the validation layer; off-vocabulary
      // values are rejected, and the quote stays the talent's words.
      const { claims, rejected } = validateStructuredOutput(track, card, {
        claims: [candidate],
        followUps: [],
      });
      if (!claims.length) {
        throw badRequest(`Fix rejected by the validation layer: ${rejected[0]?.reason ?? 'unknown'}`);
      }
      Object.assign(claim, claims[0], { talentApproved: true, anchorSource: before.anchorSource });
      if (conceding) {
        claim.concessionReason = concessionReason.trim();
        claim.defenseStatement = null; // conceded — a later Adjust is not a deadlock
        claim.defendedAt = null;
      }
    }
  } else {
    throw badRequest('action is approve, fix, defend, anchor, or contest');
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
 * System checks (FR-13 as amended by A1): advocate block only — the
 * nominee is not the talent, their lead, or a named call-maker on the
 * card. Exposure is no longer checked here: it is auto-verified from
 * CAPS (B5) or signed off by the track's exposure verifier.
 * A failed check returns the pick to the talent with the reason.
 */
export async function runSystemChecks(actor, card, nomineeUsers) {
  const failures = [];
  const text = cardText(card);

  for (const nominee of nomineeUsers) {
    if (nominee._id.equals(actor._id)) {
      failures.push({ nominee: nominee.name, reason: 'You cannot pick yourself' });
      continue;
    }
    if (actor.leadId && nominee._id.equals(actor.leadId)) {
      failures.push({ nominee: nominee.name, reason: 'Your lead cannot be your confirmer (advocate block)' });
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

  return { failures };
}

/**
 * C2: exactly one nominee per card. A1: no lead approval — the card
 * goes to the track's exposure verifier for a one-line sign-off
 * (until CAPS auto-verify lands in B5). Nobody can substitute the
 * pick: the only route out of sign-off routes to nominees[0] or back
 * to the talent.
 */
export async function submitNomination(actor, cardId, { nomineeId = null, nomineeIds = [], thinPool = false } = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.talentId.equals(actor._id)) throw forbidden('Only the card\'s talent can nominate');
  if (!actor.hasRole('talent')) throw forbidden('Talent role required');
  if (card.status !== 'talent-approved') {
    throw conflict(`Nomination happens after your approval (status "${card.status}")`);
  }

  if (thinPool) {
    // FR-15: no valid nominee exists — the track's fallback reviewer,
    // visibly marked as the exception path. Routes direct; a sign-off
    // on the backup path would check nothing.
    const track = await Track.findOne({ key: card.track });
    if (!track.fallbackReviewerId) {
      throw conflict('No backup path is set up for this track yet — ask JP');
    }
    const fallback = await User.findById(track.fallbackReviewerId);
    card.nomination.nominees = [{ userId: fallback._id, name: fallback.name, role: 'fallback reviewer' }];
    card.nomination.thinPool = true;
    card.nomination.systemChecks = { advocateBlock: 'bypassed — thin pool', exposure: 'backup path' };
    card.nomination.routedTo = fallback._id;
    card.nomination.routedAt = new Date();
    pushCardAudit(card, {
      by: actor._id,
      action: 'nomination-submitted',
      after: { nominees: [fallback.name], thinPool: true },
    });
    await transition(card, 'routed', actor._id, 'thin pool — routed to the backup path, visibly marked');
    await card.save();
    await recordAudit({ actorId: actor._id, action: 'card.nomination-submitted', entity: 'card', entityId: card._id });
    return card;
  }

  const ids = nomineeId ? [nomineeId] : nomineeIds;
  if (ids.length !== 1) throw badRequest('Pick exactly one person (C2)');
  const nomineeUsers = await User.find({ _id: { $in: ids }, active: true });
  if (nomineeUsers.length !== 1) throw badRequest('Unknown nominee');

  const { failures } = await runSystemChecks(actor, card, nomineeUsers);
  if (failures.length) {
    // The pick returns to the talent with the reason — nothing routes.
    throw badRequest('A system check returned your pick', { failures });
  }

  const track = await Track.findOne({ key: card.track });
  if (!track.exposureVerifierId) {
    throw conflict('No one is set up to check picks on this track yet — ask JP');
  }

  card.nomination.nominees = nomineeUsers.map((u) => ({ userId: u._id, name: u.name, role: 'confirmer' }));
  card.nomination.thinPool = false;
  card.nomination.systemChecks = { advocateBlock: 'passed', exposure: 'awaiting sign-off' };
  card.nomination.exposureSignoff = { decision: null, note: null, reason: null, by: null, at: null };
  pushCardAudit(card, {
    by: actor._id,
    action: 'nomination-submitted',
    after: { nominees: card.nomination.nominees.map((n) => n.name) },
  });
  await transition(card, 'exposure-signoff', actor._id, 'pick goes to the exposure verifier for a one-line sign-off (A1)');
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.nomination-submitted', entity: 'card', entityId: card._id });
  return card;
}

/**
 * Eligible nominees for the picker: active users, minus self and own
 * lead — each with their current repeat streak (C5: rotation prompt at
 * nomination time, talent-facing, advisory, never blocking).
 */
export async function nomineeCandidates(actor) {
  const query = { active: true, _id: { $ne: actor._id } };
  if (actor.leadId) query._id = { $nin: [actor._id, actor.leadId] };
  const users = await User.find(query, { name: 1, track: 1, roles: 1 }).sort({ name: 1 });
  return Promise.all(
    users.map(async (u) => ({
      _id: u._id,
      name: u.name,
      track: u.track,
      repeatStreak: await repeatStreakFor(actor._id, u._id),
    })),
  );
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

/**
 * A1: cards waiting on THIS user's exposure sign-off — they are the
 * exposure verifier on the card's track (the admin setting, read at
 * request time). Payload carries what the check needs and nothing
 * more: who filed, what project, who they picked. No claims.
 */
export async function signoffQueue(actor) {
  const tracks = await Track.find({ exposureVerifierId: actor._id }, { key: 1 });
  if (!tracks.length) return [];
  const cards = await Card.find({
    track: { $in: tracks.map((t) => t.key) },
    status: 'exposure-signoff',
  }).sort({ updatedAt: 1 });

  const talentIds = [...new Set(cards.map((c) => c.talentId.toString()))];
  const talents = await User.find({ _id: { $in: talentIds } }, { name: 1 });
  const names = Object.fromEntries(talents.map((t) => [t._id.toString(), t.name]));

  return Promise.all(
    cards.map(async (card) => ({
      _id: card._id,
      subject: card.subject,
      periodTag: card.periodTag,
      track: card.track,
      talentName: names[card.talentId.toString()] ?? '—',
      nomineeName: card.nomination.nominees[0]?.name ?? '—',
      repeatStreak: card.nomination.nominees[0]
        ? await repeatStreakFor(card.talentId, card.nomination.nominees[0].userId)
        : 0,
    })),
  );
}

/**
 * A1/C3: the exposure verifier's decision. Confirm needs one line
 * (how they know the pick saw the work) and routes to the talent's
 * pick — nominees[0], nothing else; there is no substitution input.
 * Refuse needs a stated reason and returns the pick to the talent
 * (Invariant 4's rejection leg, re-homed). Never verdict authority.
 */
export async function decideSignoff(actor, cardId, { action, note = null, reason = null } = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (card.status !== 'exposure-signoff') {
    throw conflict(`Card is not waiting on a sign-off (status "${card.status}")`);
  }
  const track = await Track.findOne({ key: card.track });
  if (!track?.exposureVerifierId?.equals?.(actor._id)) {
    throw forbidden('Only the person set to check picks on this track can sign off');
  }

  if (action === 'refuse') {
    if (!reason?.trim()) throw badRequest('Refusing needs a stated reason — it goes back to the talent');
    card.nomination.exposureSignoff = { decision: 'refuse', note: null, reason: reason.trim(), by: actor._id, at: new Date() };
    card.nomination.systemChecks.exposure = 'refused — pick returned';
    pushCardAudit(card, { by: actor._id, action: 'signoff-refuse', note: reason.trim() });
    await transition(card, 'talent-approved', actor._id, 'sign-off refused — pick returns to the talent (C3)');
    await card.save();
    await recordAudit({ actorId: actor._id, action: 'card.signoff-refuse', entity: 'card', entityId: card._id, after: { reason: reason.trim() } });
    return card;
  }

  if (action !== 'confirm') throw badRequest('Decision is confirm or refuse');
  if (!note?.trim()) throw badRequest('One line, please: how do you know they saw this work?');

  const pick = card.nomination.nominees[0];
  if (!pick) throw conflict('No pick on this card');

  card.nomination.exposureSignoff = { decision: 'confirm', note: note.trim(), reason: null, by: actor._id, at: new Date() };
  card.nomination.systemChecks.exposure = 'signed off';
  card.nomination.routedTo = pick.userId;
  card.nomination.routedAt = new Date(); // A5: the SLA clock starts here
  card.nomination.repeatStreak = (await repeatStreakFor(card.talentId, pick.userId)) + 1;
  pushCardAudit(card, { by: actor._id, action: 'signoff-confirm', note: note.trim() });
  await transition(card, 'routed', actor._id, `signed off — routed to ${pick.name}`);
  await card.save();
  await recordAudit({
    actorId: actor._id, action: 'card.signoff-confirm', entity: 'card', entityId: card._id,
    after: { routedTo: pick.name, repeatStreak: card.nomination.repeatStreak },
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
