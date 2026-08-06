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

const KIND_BY_TRACK = { ops: 'project', artasset: 'project' }; // A3: every card is per-project

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

// FR-5 card shells are RETIRED (Ruling C4, Aug 5): leads no longer open
// cards for reports. Part 4's core question survives as guidance text on
// the reviewer screen. createdViaShellBy stays on the schema for
// pre-amendment cards' history.

// ---------------------------------------------------------------------------
// Reads (visibility matrix, Plan §4)
// ---------------------------------------------------------------------------

/**
 * Visibility (C2v2): the talent and admin see everything. A checker
 * sees only approved/verdicted lines, and only THEIR lines — one
 * non-advocate per line, you judge what you saw. Other readers (a lead
 * on a confirmed card) see the approved/verdicted set.
 * The FR-11 calibration hold is retired (JP, Aug 6): structured cards
 * go straight to the talent; JP spot-checks released cards instead.
 */
const STALE_MS = 60 * 24 * 60 * 60 * 1000;

const NUDGE_IDLE_MS = 83 * 24 * 60 * 60 * 1000;

export function presentCard(actor, card) {
  const obj = typeof card.toObject === 'function' ? card.toObject() : card;
  // Invariant 5: no claim reaches anyone but the talent (and admin)
  // without the talent's per-claim approval — unapproved drafts are
  // invisible to reviewers and every other reader.
  const isOwn = obj.talentId?.toString?.() === actor._id?.toString?.();
  if (!isOwn && !actor.hasRole('admin') && Array.isArray(obj.claims)) {
    obj.claims = obj.claims.filter((c) => c.talentApproved || c.verdict);
    const actorId = actor._id?.toString?.();
    const isChecker =
      (obj.nomination?.routes || []).some((r) => r.reviewerId?.toString?.() === actorId) ||
      obj.nomination?.routedTo?.toString?.() === actorId;
    if (isChecker) {
      // C2v2: one non-advocate per line — a checker reads and judges
      // only the lines the talent sent to THEM (legacy cards with no
      // per-line checker fall back to the whole approved set).
      obj.claims = obj.claims.filter((c) => (c.checkerId ? c.checkerId.toString() === actorId : true));
    }
  }
  // BR-4: filed 60+ days after close carries STALE — context, never a block.
  if (obj.filedDate && obj.closeDate && new Date(obj.filedDate) - new Date(obj.closeDate) > STALE_MS) {
    obj.stale = true;
  }
  // A4: the one pre-expiry nudge surfaces on home — plain, no blame.
  if (obj.status === 'draft' && !obj.submittedForStructuringAt && Date.now() - new Date(obj.updatedAt) > NUDGE_IDLE_MS) {
    obj.archivesSoon = true;
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
  const isRoutedToActor =
    (card.nomination?.routedTo?.equals?.(actor._id) ?? false) ||
    (card.nomination?.routes || []).some((r) => r.reviewerId?.equals?.(actor._id));
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
  return Card.find({
    status: 'routed',
    $or: [{ 'nomination.routedTo': actor._id }, { 'nomination.routes.reviewerId': actor._id }],
  }).sort({ updatedAt: -1 });
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
  // B7 hard guard: on a conversation card the WORDS live in the
  // conversation — no form patch may replace answers, the sweep, or the
  // mode (the JP data-loss bug, Aug 5: a stale form autosave clobbered a
  // finished conversation at submit time).
  if (card.captureMode === 'conversation') {
    pushCardAudit(card, { by: actor._id, action: 'draft-autosave', note: 'conversation card — name/date only' });
    await card.save();
    await recordAudit({ actorId: actor._id, action: 'card.update-draft', entity: 'card', entityId: card._id });
    return card;
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

/**
 * A4: revive an archived draft. Only cards archived FROM draft come
 * back — a confirmed card's archive is permanent record, not a parking
 * spot. Raw answers were never touched (Invariant 15).
 */
export async function reviveCard(actor, cardId) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  assertOwnCard(actor, card);
  if (!actor.hasRole('talent')) throw forbidden('Only talent can revive their card');
  if (card.status !== 'archived') throw conflict(`Card is not archived (status "${card.status}")`);
  if (card.archivedFrom !== 'draft') {
    throw conflict('Only archived drafts revive — a confirmed card stays on the record as it is');
  }

  card.archivedFrom = null;
  card.archiveNudgeAt = null;
  pushCardAudit(card, { by: actor._id, action: 'draft-revived' });
  await transition(card, 'draft', actor._id, 'revived from archive — nothing was lost');
  await card.save();
  await recordAudit({ actorId: actor._id, action: 'card.draft-revived', entity: 'card', entityId: card._id });
  return card;
}

// ---------------------------------------------------------------------------
// Nomination lives in confirmService (P4): talent tags via submitNomination
// with FR-13 system checks; the exposure verifier signs off via
// decideSignoff. NOBODY substitutes (Invariant 4).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Verdict (Invariant 3 — the sovereignty guard)
// ---------------------------------------------------------------------------

/**
 * The verdict field is writable ONLY by the card's assigned non-advocate.
 * The check is assignment-based: admin, lead, JP, and any other role are
 * rejected identically. This is the server law the role matrix row
 * "Verdict → N N Y(assigned only) N" describes.
 *
 * A5: Confirmed requires a one-line attestation of what was checked;
 * Adjust requires its note. Both live in verdictNote — stored, audited,
 * spot-checkable.
 *
 * C1: verdicts are also writable in 'ruled' (reviewer re-reviews with
 * JP's ruling in view) and 'reassigned' (fallback reviewer). A reviewer
 * holding Adjust on a DEFENDED claim in 'routed' deadlocks the card —
 * both final positions logged permanently.
 */
const REVIEWABLE_STATUSES = ['routed', 'ruled', 'reassigned'];

export async function applyVerdict(actor, cardId, claimId, { verdict, note = null }) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');

  const claim = card.claims.id(claimId);
  if (!claim) throw notFound('Claim not found');
  // C2v2: one non-advocate per LINE — the verdict guard is the line's
  // assigned checker (legacy cards fall back to the card-level route).
  // Admin, lead, JP, and every other checker are rejected identically.
  const assigned = claim.checkerId ?? card.nomination?.routedTo;
  if (!assigned || !assigned.equals(actor._id)) {
    throw forbidden('Only this line\'s assigned checker can write a verdict');
  }
  if (!REVIEWABLE_STATUSES.includes(card.status)) {
    throw conflict(`Card is not reviewable in status "${card.status}"`);
  }
  if (!['Confirmed', 'Adjust'].includes(verdict)) throw badRequest('Verdict is Confirmed or Adjust');
  if (verdict === 'Adjust' && !note?.trim()) {
    throw badRequest('Adjust requires a note — it returns the card to the talent');
  }
  if (verdict === 'Confirmed' && !note?.trim()) {
    throw badRequest('Confirmed requires a one-line attestation: what did you check?');
  }

  if (!claim.talentApproved && !claim.verdict) {
    throw conflict('This line was never approved by the talent — it stays a draft and takes no verdict (Invariant 5)');
  }

  const before = { verdict: claim.verdict, verdictNote: claim.verdictNote };
  claim.verdict = verdict;
  claim.verdictNote = note;
  claim.verdictBy = actor._id;
  claim.verdictAt = new Date();
  // BR-7: Adjust returns the claim to the talent — their prior approval
  // no longer stands; revision requires a fresh approve, fix, or defence.
  if (verdict === 'Adjust') claim.talentApproved = false;
  pushCardAudit(card, {
    by: actor._id,
    action: 'verdict',
    before,
    after: { verdict, verdictNote: note },
    note: `claim ${claimId}`,
  });

  // BR-7: Confirmed is the only accepting verdict; the card-level
  // transition happens when every ROUTED line has one. Thin drafts the
  // talent left behind (never approved, never verdicted) don't count —
  // they were never routed.
  const inPlay = card.claims.filter((c) => c.talentApproved || c.verdict !== null);
  const allDecided = inPlay.length > 0 && inPlay.every((c) => c.verdict !== null);
  if (allDecided) {
    const anyAdjust = inPlay.some((c) => c.verdict === 'Adjust');
    // C1 deadlock: the reviewer held Adjust on a claim the talent defended.
    const heldOnDefended =
      card.status === 'routed' &&
      card.claims.some((c) => c.verdict === 'Adjust' && c.defenseStatement);
    if (heldOnDefended) {
      const positions = card.claims
        .filter((c) => c.verdict === 'Adjust' && c.defenseStatement)
        .map((c) => ({
          claim: c.competencyOrDomain,
          talentFinalPosition: c.defenseStatement,
          reviewerFinalPosition: c.verdictNote,
        }));
      card.deadlockedAt = new Date();
      pushCardAudit(card, {
        by: actor._id,
        action: 'deadlocked',
        after: { positions },
        note: 'talent defends, reviewer holds — escalates to JP as non-partisan judge (C1); both final positions logged permanently',
      });
      await transition(card, 'deadlocked', actor._id);
    } else {
      await transition(card, anyAdjust ? 'adjust' : 'confirmed', actor._id);
    }
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
