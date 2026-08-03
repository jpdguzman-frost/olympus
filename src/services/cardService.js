/**
 * Card mutations + reads with the Plan §4 role matrix enforced at the
 * service layer (NFR-1: server law; the client is untrusted).
 *
 * Invariants carried here:
 *  - 3: verdict writable ONLY by the card's assigned non-advocate — the
 *       applyVerdict guard checks assignment, not role, and admin is
 *       rejected like everyone else.
 *  - 4: no nominee-substitution path exists; a lead decision is
 *       approve or reject+reason, and reject returns the pick to the talent.
 *  - 11: pre-fill boundary — confirmed-card context is a separate read;
 *       nothing here ever writes prior content into answer fields.
 *  - 15: raw answers persist on every autosave; submit never destroys them.
 *  - 17: every mutation is audited (embedded + global).
 */

import { Card } from '../models/Card.js';
import { User } from '../models/User.js';
import { badRequest, forbidden, notFound, conflict } from '../utils/httpError.js';
import { periodTagFor } from '../utils/periodTag.js';
import { pushCardAudit, recordAudit } from './auditService.js';
import { transition } from './statusMachine.js';

const KIND_BY_TRACK = { ops: 'account', artasset: 'project' };

function assertOwnCard(actor, card) {
  if (!card.talentId.equals(actor._id)) {
    throw forbidden('Only the card\'s talent can do this');
  }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Talent starts their own draft (FR-3/FR-4). */
export async function createDraft(actor, { subjectName = '', closeDate = null, captureMode = null } = {}) {
  if (!actor.hasRole('talent')) throw forbidden('Only talent can start a card');
  if (!actor.track) throw badRequest('Your account has no track assigned — ask JP');

  const card = new Card({
    talentId: actor._id,
    track: actor.track,
    subject: { name: subjectName, kind: KIND_BY_TRACK[actor.track] },
    closeDate,
    periodTag: periodTagFor(closeDate),
    captureMode,
    status: 'draft',
  });
  pushCardAudit(card, { by: actor._id, action: 'card-created' });
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.create', entity: 'card', entityId: card._id });
  return card;
}

/** Lead opens a shell for a report: name + close date ONLY, no content (FR-5). */
export async function createShell(actor, { reportUserId, subjectName, closeDate }) {
  if (!actor.hasRole('lead')) throw forbidden('Only a lead can open a card shell');
  if (!subjectName || !closeDate) throw badRequest('A shell is a name and a close date');

  const report = await User.findById(reportUserId);
  if (!report || !report.active) throw notFound('No such report');
  if (!report.leadId || !report.leadId.equals(actor._id)) {
    throw forbidden('You can only open shells for your own reports');
  }
  if (!report.track) throw badRequest('That report has no track assigned');

  const card = new Card({
    talentId: report._id,
    track: report.track,
    subject: { name: subjectName, kind: KIND_BY_TRACK[report.track] },
    closeDate,
    periodTag: periodTagFor(closeDate),
    status: 'draft',
    createdViaShellBy: actor._id,
  });
  pushCardAudit(card, { by: actor._id, action: 'shell-created', note: 'lead-opened shell: name + close date only' });
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.shell-create', entity: 'card', entityId: card._id });
  return card;
}

// ---------------------------------------------------------------------------
// Reads (visibility matrix, Plan §4)
// ---------------------------------------------------------------------------

/**
 * FR-11: while a card holds in calibration, its claims queue to Admin
 * BEFORE the talent sees them. Everyone but admin gets the card with
 * claims/follow-ups stripped and an inCalibration marker.
 */
const STALE_MS = 60 * 24 * 60 * 60 * 1000;

export function presentCard(actor, card) {
  const obj = typeof card.toObject === 'function' ? card.toObject() : card;
  // BR-4: filed 60+ days after close carries STALE — context, never a block.
  if (obj.filedDate && obj.closeDate && new Date(obj.filedDate) - new Date(obj.closeDate) > STALE_MS) {
    obj.stale = true;
  }
  if (obj.calibrationHold && !actor.hasRole('admin')) {
    return { ...obj, claims: [], followUps: [], inCalibration: true };
  }
  return obj;
}

export function presentCards(actor, cardsList) {
  return cardsList.map((c) => presentCard(actor, c));
}

export async function getCardForRead(actor, cardId) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');

  const isOwn = card.talentId.equals(actor._id);
  const isRoutedToActor = card.nomination?.routedTo?.equals?.(actor._id) ?? false;
  const isAdmin = actor.hasRole('admin');

  let isLeadOfTalent = false;
  if (actor.hasRole('lead')) {
    const talent = await User.findById(card.talentId);
    isLeadOfTalent = Boolean(talent?.leadId?.equals?.(actor._id));
  }

  // AC-7: a talent's card is invisible to other talents; a non-advocate
  // sees only cards routed to them. A lead sees a report's card only once
  // confirmed — except the shell fields of drafts they opened themselves.
  if (isOwn || isAdmin || isRoutedToActor) return card;
  if (isLeadOfTalent && card.status === 'confirmed') return card;
  throw notFound('Card not found'); // 404, not 403 — existence is not leaked
}

export function listOwnCards(actor) {
  return Card.find({ talentId: actor._id }).sort({ updatedAt: -1 });
}

export async function listTeamConfirmed(actor) {
  if (!actor.hasRole('lead')) throw forbidden('Lead role required');
  const reports = await User.find({ leadId: actor._id, active: true }, { _id: 1 });
  return Card.find({
    talentId: { $in: reports.map((r) => r._id) },
    status: 'confirmed',
  }).sort({ updatedAt: -1 });
}

export async function listQueue(actor) {
  return Card.find({ 'nomination.routedTo': actor._id, status: 'routed' }).sort({ updatedAt: -1 });
}

/**
 * FR-6: prior confirmed cards render as CONTEXT above the input — this
 * read is the only pre-fill surface, and it never touches answer fields
 * (Invariant 11).
 */
export function confirmedContext(actor, subjectName = null) {
  const query = { talentId: actor._id, status: 'confirmed' };
  if (subjectName) query['subject.name'] = subjectName;
  return Card.find(query).sort({ closeDate: -1 }).limit(5);
}

// ---------------------------------------------------------------------------
// Talent edits (own card answers/edits: talent only — Plan §4 row 1)
// ---------------------------------------------------------------------------

const TALENT_EDITABLE_STATUSES = ['draft', 'adjust'];

/**
 * Whitelisted autosave patch. Anything outside the whitelist — status,
 * claims, verdict, nomination decisions, periodTag — is silently absent
 * from the result because it is never read from the body at all.
 */
export async function updateDraft(actor, cardId, patch = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  assertOwnCard(actor, card);
  if (!actor.hasRole('talent')) throw forbidden('Only talent can edit answers');
  if (!TALENT_EDITABLE_STATUSES.includes(card.status)) {
    throw conflict(`Card is not editable in status "${card.status}"`);
  }

  if (typeof patch.subjectName === 'string') card.subject.name = patch.subjectName;
  if (patch.closeDate !== undefined) {
    card.closeDate = patch.closeDate ? new Date(patch.closeDate) : null;
    card.periodTag = periodTagFor(card.closeDate);
  }
  if (patch.captureMode === 'guided' || patch.captureMode === 'single-pass') {
    card.captureMode = patch.captureMode;
  }
  if (Array.isArray(patch.rawAnswers)) {
    card.rawAnswers = patch.rawAnswers.map((a) => ({
      questionIndex: a.questionIndex ?? null,
      question: String(a.question ?? ''),
      answer: String(a.answer ?? ''),
      at: new Date(),
    }));
  }
  if (Array.isArray(patch.sweepAnswers)) {
    card.sweepAnswers = patch.sweepAnswers.map((s) => ({
      prompt: String(s.prompt ?? ''),
      answer: String(s.answer ?? ''),
      at: new Date(),
    }));
  }
  if (typeof patch.honestGap === 'string') card.honestGap = patch.honestGap;

  pushCardAudit(card, { by: actor._id, action: 'draft-autosave' });
  await card.save(); // Invariant 15: raw persists before any structuring runs
  await recordAudit({ actorId: actor._id, action: 'card.update-draft', entity: 'card', entityId: card._id });
  return card;
}

/**
 * Submit for structuring. Raw answers are already persisted (autosave);
 * this stamps the submission and hands off to the structurer — which in
 * P2 does not exist yet. AI absence/failure degrades safely: the card
 * keeps status draft with raw intact and submit is retryable (AC-8).
 */
export async function submitForStructuring(actor, cardId) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  assertOwnCard(actor, card);
  if (!actor.hasRole('talent')) throw forbidden('Only talent can submit their card');
  if (card.status !== 'draft') throw conflict(`Card is not submittable in status "${card.status}"`);

  const answered = card.rawAnswers.filter((a) => a.answer.trim().length > 0);
  if (answered.length === 0) throw badRequest('Nothing to structure — the card has no answers yet');
  if (card.sweepAnswers.length === 0) {
    throw badRequest('The coverage sweep comes after your answers — answer it (“not me” is a fine answer) before submitting');
  }

  card.submittedForStructuringAt = new Date();
  if (!card.filedDate) card.filedDate = new Date();
  pushCardAudit(card, { by: actor._id, action: 'submitted-for-structuring' });
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.submit', entity: 'card', entityId: card._id });

  // P3 boundary: the structurer service lands in the next phase. The card
  // is safe where it is; structuring will pick up submitted drafts.
  return { card, structuring: 'pending-p3' };
}

// ---------------------------------------------------------------------------
// Nomination lives in confirmService (P4): talent tags via submitNomination
// with FR-13 system checks; lead selects-or-rejects via decideNomination.
// NOBODY substitutes (Invariant 4).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Verdict (Invariant 3 — the sovereignty guard)
// ---------------------------------------------------------------------------

/**
 * The verdict field is writable ONLY by the card's assigned non-advocate.
 * The check is assignment-based: admin, lead, JP, and any other role are
 * rejected identically. This is the server law the role matrix row
 * "Verdict → N N Y(assigned only) N" describes.
 */
export async function applyVerdict(actor, cardId, claimId, { verdict, note = null }) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');

  const routedTo = card.nomination?.routedTo;
  if (!routedTo || !routedTo.equals(actor._id)) {
    throw forbidden('Only the card\'s assigned reviewer can write a verdict');
  }
  if (card.status !== 'routed') throw conflict(`Card is not reviewable in status "${card.status}"`);
  if (!['Confirmed', 'Adjust'].includes(verdict)) throw badRequest('Verdict is Confirmed or Adjust');
  if (verdict === 'Adjust' && !note?.trim()) {
    throw badRequest('Adjust requires a note — it returns the card to the talent');
  }

  const claim = card.claims.id(claimId);
  if (!claim) throw notFound('Claim not found');

  const before = { verdict: claim.verdict, verdictNote: claim.verdictNote };
  claim.verdict = verdict;
  claim.verdictNote = note;
  claim.verdictBy = actor._id;
  claim.verdictAt = new Date();
  // BR-7: Adjust returns the claim to the talent — their prior approval
  // no longer stands; revision requires a fresh approve or fix.
  if (verdict === 'Adjust') claim.talentApproved = false;
  pushCardAudit(card, {
    by: actor._id,
    action: 'verdict',
    before,
    after: { verdict, verdictNote: note },
    note: `claim ${claimId}`,
  });

  // BR-7: Confirmed is the only accepting verdict; card-level transition
  // happens when every claim has a verdict.
  const allDecided = card.claims.every((c) => c.verdict !== null);
  if (allDecided) {
    const anyAdjust = card.claims.some((c) => c.verdict === 'Adjust');
    await transition(card, anyAdjust ? 'adjust' : 'confirmed', actor._id);
  }

  await card.save();
  await recordAudit({
    actorId: actor._id,
    action: 'card.verdict',
    entity: 'card',
    entityId: card._id,
    before,
    after: { verdict, verdictNote: note },
  });
  return card;
}
