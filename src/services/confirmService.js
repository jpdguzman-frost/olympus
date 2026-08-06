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

  // JP's thin-line rule (Aug 6): a line flagged "insufficient detail —
  // draft" cannot be approved, fixed-and-kept, or defended as-is. The
  // talent adds the missing piece (their words, re-checked by the AI)
  // or leaves it — it stays a draft and costs nothing.
  const THIN_FLAG = 'insufficient detail — draft';
  const isThin = (claim.flags || []).includes(THIN_FLAG);
  if (isThin && (['approve', 'defend'].includes(action) || (action === 'fix' && !remove))) {
    throw badRequest('This line is too thin to count yet — add the missing piece (when it was, where, or something a reviewer could check), or leave it as a draft. It costs you nothing either way.');
  }

  if (action === 'add-detail') {
    const text = statement;
    if (!text?.trim()) throw badRequest('Say the missing piece — when it was, where, or something a reviewer could check');
    // Invariant 15: the talent's new words persist as raw answers — and
    // become quotable — before the AI re-checks the line.
    card.rawAnswers.push({
      questionIndex: null,
      question: `Added detail for: ${claim.competencyOrDomain}`,
      answer: text.trim(),
      at: new Date(),
    });
    if (card.captureMode === 'conversation') {
      card.conversation.push({ role: 'talent', kind: 'answer', text: text.trim() });
    }
    const open = (claim.contentions || []).find((c) => c.outcome === null);
    if (open) throw conflict('This line is already being re-checked — the answer lands here shortly');
    claim.contentions.push({ text: `The talent added detail for this line: ${text.trim()}`, at: new Date(), outcome: null });
    claim.talentApproved = false;
    pushCardAudit(card, { by: actor._id, action: 'claim-detail-added', note: text.trim() });
    await card.save();
    await recordAudit({ actorId: actor._id, action: 'card.claim-detail-added', entity: 'card', entityId: card._id });
    return card;
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
    throw badRequest('action is approve, fix, defend, anchor, contest, or add-detail');
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
  // Invariant 5, made real: partial approval routes only approved
  // claims. Thin drafts (JP's rule) don't block the card — they stay
  // behind as drafts, invisible to the reviewer, costing nothing.
  const THIN_FLAG = 'insufficient detail — draft';
  const blocking = card.claims.filter((c) => !c.talentApproved && !(c.flags || []).includes(THIN_FLAG));
  if (blocking.length) {
    throw conflict(`${blocking.length} claim(s) still need your approve or fix`);
  }
  if (!card.claims.some((c) => c.talentApproved)) {
    throw conflict('Every line is still a thin draft — add the missing details, or nothing can route yet');
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
 * C2v2 (JP, Aug 6 — supersedes C2): THE one send. Reading the document
 * screen is the review; this single action is the act of approval.
 * Every ready line gets its per-line approval record here (Invariant 5
 * partial approval intact), one pick covers every line, any line can be
 * switched to a different checker — exactly ONE non-advocate per line.
 * Set-aside lines (thin / no date) and unticked lines stay behind as
 * costless drafts, invisible to every checker.
 *
 * Routes fan out per distinct checker: each resolves exposure on its
 * own (CAPS auto-verify, else the track verifier's sign-off), and each
 * carries its own SLA clock once routed. The card routes when every
 * pick has cleared.
 */
const THIN_FLAG = 'insufficient detail — draft';

export async function sendPicks(actor, cardId, { checkerId = null, lineOverrides = {}, unticked = [], honestGap, thinPool = false } = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.talentId.equals(actor._id)) throw forbidden('Only the card\'s talent can send their card');
  if (!actor.hasRole('talent')) throw forbidden('Talent role required');
  // 'exposure-signoff' is re-sendable too: a JP spot-check during the
  // sign-off wait pulls a line back, and the talent re-looks + re-sends.
  if (!['structured', 'talent-approved', 'exposure-signoff'].includes(card.status)) {
    throw conflict(`Card is not sendable (status "${card.status}")`);
  }
  if (!card.claims.length) throw conflict('No lines to send — nothing can route');

  const untickedSet = new Set(unticked.map(String));
  const setAside = (c) => !c.anchorText || (c.flags || []).includes(THIN_FLAG);
  const eligible = card.claims.filter(
    (c) => c.verdict === null && !setAside(c) && !untickedSet.has(String(c._id)),
  );
  if (!eligible.length) {
    throw conflict('Every line is either not backed yet or left out — back one up first, or there is nothing to send');
  }

  const track = await Track.findOne({ key: card.track });

  // Resolve every pick BEFORE touching the card — a failed check returns
  // the pick with the reason and nothing moves.
  let picksByClaim;
  let users;
  if (thinPool) {
    // FR-15: no valid pick exists — the track's fallback reviewer,
    // visibly marked as the exception path. No sign-off: a check on the
    // backup path would check nothing.
    if (!track.fallbackReviewerId) throw conflict('No backup path is set up for this track yet — ask JP');
    const fallback = await User.findById(track.fallbackReviewerId);
    if (!fallback?.active) throw conflict('The backup reviewer is not available — ask JP');
    users = [fallback];
    picksByClaim = new Map(eligible.map((c) => [String(c._id), fallback]));
  } else {
    const wanted = new Map();
    for (const claim of eligible) {
      const id = String(lineOverrides[String(claim._id)] || checkerId || '');
      if (!id) throw badRequest('Pick who checks this — one person covers every line unless you switch a line');
      wanted.set(String(claim._id), id);
    }
    const ids = [...new Set(wanted.values())];
    users = await User.find({ _id: { $in: ids }, active: true });
    if (users.length !== ids.length) throw badRequest('Unknown or inactive pick');
    const byId = new Map(users.map((u) => [String(u._id), u]));
    picksByClaim = new Map([...wanted].map(([claimId, id]) => [claimId, byId.get(id)]));

    const { failures } = await runSystemChecks(actor, card, users);
    if (failures.length) throw badRequest('A system check returned your pick', { failures });
  }

  // Resolve exposure per distinct pick, reusing a pick that already
  // cleared on this card (signed off / auto-verified) — a re-send after
  // one refused pick never re-checks the others.
  const prior = new Map((card.nomination.routes || []).map((r) => [String(r.reviewerId), r]));
  const { reviewExposure } = await import('./capsService.js');
  const routes = [];
  let anyAwaiting = false;
  for (const user of users) {
    const prev = prior.get(String(user._id));
    const cleared =
      prev && (prev.signoff?.decision === 'confirm' || (prev.exposure || '').startsWith('auto-verified') || prev.exposure === 'backup path');
    if (cleared) {
      routes.push(prev.toObject ? prev.toObject() : prev);
      continue;
    }
    const streak = (await repeatStreakFor(card.talentId, user._id)) + 1;
    if (thinPool) {
      routes.push({ reviewerId: user._id, name: user.name, exposure: 'backup path', repeatStreak: streak });
      continue;
    }
    const exposure = await reviewExposure(actor.capsName, user.capsName, card.subject.name);
    if (exposure.verified) {
      routes.push({
        reviewerId: user._id,
        name: user.name,
        exposure: `auto-verified — they reviewed this work across ${exposure.weeks} different weeks (CAPS)`,
        repeatStreak: streak,
      });
    } else {
      anyAwaiting = true;
      routes.push({ reviewerId: user._id, name: user.name, exposure: 'awaiting sign-off', repeatStreak: streak });
    }
  }
  if (anyAwaiting && !track.exposureVerifierId) {
    throw conflict('No one is set up to check picks on this track yet — ask JP');
  }

  // All checks passed — now the card changes. Reading was the review;
  // this send IS the per-line approval (Invariant 5).
  for (const claim of card.claims) {
    if (eligible.includes(claim)) {
      claim.talentApproved = true;
      claim.checkerId = picksByClaim.get(String(claim._id))._id;
      claim.needsRelook = false;
    } else if (claim.verdict === null) {
      // stays behind as a costless draft, invisible to every checker
      claim.talentApproved = false;
      claim.checkerId = null;
    }
  }
  if (typeof honestGap === 'string' && honestGap.trim()) card.honestGap = honestGap;

  card.nomination.nominees = users.map((u) => ({ userId: u._id, name: u.name, role: thinPool ? 'fallback reviewer' : 'confirmer' }));
  card.nomination.thinPool = Boolean(thinPool);
  card.nomination.systemChecks = thinPool
    ? { advocateBlock: 'bypassed — thin pool', exposure: 'backup path' }
    : { advocateBlock: 'passed', exposure: anyAwaiting ? 'awaiting sign-off' : 'cleared' };
  card.nomination.routes = routes;

  const leftBehind = card.claims.length - eligible.length;
  pushCardAudit(card, {
    by: actor._id,
    action: 'card-sent',
    after: {
      lines: eligible.length,
      leftBehind,
      picks: routes.map((r) => ({ name: r.name, lines: eligible.filter((c) => c.checkerId.equals(r.reviewerId)).length, exposure: r.exposure })),
    },
    note: `one send = per-line approval on ${eligible.length} line(s); ${leftBehind} stay(s) behind as draft (C2v2)`,
  });

  if (card.status === 'structured') {
    await transition(card, 'talent-approved', actor._id, 'talent read the write-up and sent it — every sent line carries their approval');
  }
  if (anyAwaiting) {
    if (card.status !== 'exposure-signoff') {
      await transition(card, 'exposure-signoff', actor._id, 'a pick goes to the exposure verifier for a one-line sign-off (A1)');
    }
  } else {
    const now = new Date();
    for (const route of card.nomination.routes) if (!route.routedAt) route.routedAt = now; // A5: each route's clock
    card.nomination.routedAt = card.nomination.routedAt || now;
    await transition(
      card,
      'routed',
      actor._id,
      thinPool ? 'thin pool — routed to the backup path, visibly marked' : `every pick cleared — routed to ${routes.map((r) => r.name).join(', ')}`,
    );
  }
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.sent', entity: 'card', entityId: card._id, after: { picks: routes.map((r) => r.name) } });
  return card;
}

/**
 * Legacy single-pick entry (old tests / API shape) — routes through the
 * C2v2 one-send builder: one pick covers every line.
 */
export async function submitNomination(actor, cardId, { nomineeId = null, nomineeIds = [], thinPool = false } = {}) {
  if (thinPool) return sendPicks(actor, cardId, { thinPool: true });
  const ids = nomineeId ? [nomineeId] : nomineeIds;
  if (ids.length !== 1) throw badRequest('Pick exactly one person to cover the card — single lines can be switched on the screen (C2v2)');
  return sendPicks(actor, cardId, { checkerId: ids[0] });
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
    {
      talentId,
      $or: [{ 'nomination.routes.0': { $exists: true } }, { 'nomination.routedTo': { $ne: null } }],
      status: { $in: ['routed', 'confirmed', 'adjust', 'revised', 'archived'] },
    },
    { 'nomination.routedTo': 1, 'nomination.routes.reviewerId': 1, updatedAt: 1 },
  )
    .sort({ updatedAt: -1 })
    .limit(10);
  let streak = 0;
  for (const card of prior) {
    const reviewerIds = card.nomination.routes?.length
      ? card.nomination.routes.map((r) => String(r.reviewerId))
      : [String(card.nomination.routedTo)];
    if (reviewerIds.includes(String(reviewerId))) streak += 1;
    else break;
  }
  return streak;
}

/**
 * A1: picks waiting on THIS user's exposure sign-off — they are the
 * exposure verifier on the card's track (the admin setting, read at
 * request time). One row PER AWAITING PICK (C2v2: a card can carry
 * several). Payload carries what the check needs and nothing more:
 * who filed, what project, who they picked. No claims.
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

  const rows = [];
  for (const card of cards) {
    for (const route of card.nomination.routes.filter((r) => r.exposure === 'awaiting sign-off')) {
      rows.push({
        _id: card._id,
        reviewerId: route.reviewerId,
        subject: card.subject,
        periodTag: card.periodTag,
        track: card.track,
        talentName: names[card.talentId.toString()] ?? '—',
        nomineeName: route.name || '—',
        lines: card.claims.filter((c) => c.checkerId?.equals?.(route.reviewerId)).length,
        repeatStreak: route.repeatStreak ?? 0,
      });
    }
  }
  return rows;
}

/**
 * A1/C3: the exposure verifier's decision, PER PICK (C2v2). Confirm
 * needs one line (how they know the pick saw the work); once every
 * awaiting pick on the card has cleared, all routes go live together.
 * Refuse needs a stated reason and returns the whole card to the
 * talent to re-pick that route's lines (Invariant 4's rejection leg,
 * re-homed) — cleared picks are kept and never re-checked on re-send.
 * Never verdict authority; there is no substitution input.
 */
export async function decideSignoff(actor, cardId, { action, note = null, reason = null, reviewerId = null } = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (card.status !== 'exposure-signoff') {
    throw conflict(`Card is not waiting on a sign-off (status "${card.status}")`);
  }
  const track = await Track.findOne({ key: card.track });
  if (!track?.exposureVerifierId?.equals?.(actor._id)) {
    throw forbidden('Only the person set to check picks on this track can sign off');
  }

  const awaiting = card.nomination.routes.filter((r) => r.exposure === 'awaiting sign-off');
  const route = reviewerId
    ? awaiting.find((r) => String(r.reviewerId) === String(reviewerId))
    : awaiting.length === 1
      ? awaiting[0]
      : null;
  if (!route) throw badRequest('Say which pick this decision is for — this card has more than one waiting');

  if (action === 'refuse') {
    if (!reason?.trim()) throw badRequest('Refusing needs a stated reason — it goes back to the talent');
    route.signoff = { decision: 'refuse', note: null, reason: reason.trim(), by: actor._id, at: new Date() };
    route.exposure = 'refused — pick returned';
    // Card-level record too (C3): the route entry leaves with the pick,
    // but the refusal and its reason stay readable on the card.
    card.nomination.exposureSignoff = { decision: 'refuse', note: null, reason: reason.trim(), by: actor._id, at: new Date() };
    // The refusal is about the pick, never the words (C3): the lines keep
    // the talent's approval; only the checker slot opens back up.
    for (const claim of card.claims) {
      if (claim.checkerId?.equals?.(route.reviewerId)) claim.checkerId = null;
    }
    card.nomination.routes = card.nomination.routes.filter((r) => r !== route);
    card.nomination.systemChecks.exposure = 'refused — pick returned';
    pushCardAudit(card, { by: actor._id, action: 'signoff-refuse', note: reason.trim(), after: { pick: route.name } });
    await transition(card, 'talent-approved', actor._id, `sign-off refused for ${route.name} — that pick returns to the talent (C3)`);
    await card.save();
    await recordAudit({ actorId: actor._id, action: 'card.signoff-refuse', entity: 'card', entityId: card._id, after: { reason: reason.trim(), pick: route.name } });
    return card;
  }

  if (action !== 'confirm') throw badRequest('Decision is confirm or refuse');
  if (!note?.trim()) throw badRequest('One line, please: how do you know they saw this work?');

  route.signoff = { decision: 'confirm', note: note.trim(), reason: null, by: actor._id, at: new Date() };
  route.exposure = 'signed off';
  pushCardAudit(card, { by: actor._id, action: 'signoff-confirm', note: note.trim(), after: { pick: route.name } });

  const stillWaiting = card.nomination.routes.some((r) => r.exposure === 'awaiting sign-off');
  if (!stillWaiting) {
    const now = new Date();
    for (const r of card.nomination.routes) if (!r.routedAt) r.routedAt = now; // A5: each route's clock starts here
    card.nomination.routedAt = card.nomination.routedAt || now;
    card.nomination.systemChecks.exposure = 'cleared';
    await transition(card, 'routed', actor._id, `every pick cleared — routed to ${card.nomination.routes.map((r) => r.name).join(', ')}`);
  }
  await card.save();
  await recordAudit({
    actorId: actor._id, action: 'card.signoff-confirm', entity: 'card', entityId: card._id,
    after: { pick: route.name, routed: !stillWaiting },
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
  const backTo = new Set();
  for (const claim of card.claims) {
    if (claim.verdict === 'Adjust') {
      claim.verdict = null;
      claim.verdictNote = null;
      claim.verdictBy = null;
      claim.verdictAt = null;
      if (claim.checkerId) backTo.add(String(claim.checkerId));
    }
  }
  // A5: only the routes getting lines back restart their SLA clock.
  const now = new Date();
  for (const route of card.nomination.routes || []) {
    if (backTo.has(String(route.reviewerId))) route.routedAt = now;
  }
  card.nomination.routedAt = now; // legacy single-route cards
  await transition(card, 'revised', actor._id, 'talent revised after Adjust');
  await transition(card, 'routed', actor._id, 're-routed to the same reviewer');
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.reroute-after-revision', entity: 'card', entityId: card._id });
  return card;
}
