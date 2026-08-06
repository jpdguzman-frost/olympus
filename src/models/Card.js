/**
 * cards — the evidence card, Plan §3 verbatim shape.
 *
 * Claims are embedded. The claim's `labels` object is deliberately
 * schema-loose (Mixed): its exact keys come from the track's versioned
 * vocab pack, and the server-side vocabulary validation layer (FR-10,
 * arrives with the P3 structurer) is the gate — not mongoose.
 *
 * Two fields carry invariants directly:
 *  - claims[].verdict: writable ONLY through CardService.applyVerdict by
 *    the assigned non-advocate (Invariant 3). No route ever whitelists it.
 *  - audit[]: append-only; entries are pushed, never edited (Invariant 17).
 */

import mongoose from 'mongoose';
import { CARD_STATUSES, TRACK_KEYS } from '../config/constants.js';

const { Schema } = mongoose;

const claimSchema = new Schema(
  {
    type: { type: String },
    competencyOrDomain: { type: String, required: true },
    labels: { type: Schema.Types.Mixed, default: {} },
    sourceQuote: { type: String, required: true }, // Invariant 9: every claim carries its source quote
    involvement: { type: String, default: null },
    countAfterMe: { type: Number, default: null }, // the model's own count — factual, not effort
    // Flags are validated by the FR-10 layer against the pack's claim-flag
    // list (C6 two layers; packs version faster than code) — no mongoose
    // enum, or a new pack's flags would be rejected at save time.
    flags: [{ type: String }],
    // C2v2 document screen (JP, Aug 6): every line explains itself.
    // rationale = why the line reads the way it does, in plain words
    // (AI-authored — it is an explanation, never a quote). missingPiece
    // = exactly what an evidence-gated line still needs (only set when
    // the line carries the thin flag).
    rationale: { type: String, default: null },
    missingPiece: { type: String, default: null },
    // C2v2: one non-advocate per line. Set at send time; every routed
    // line carries exactly one checker. null = not sent (draft line).
    checkerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // C2v2: the per-line talk-it-out thread (clarify the rationale, back
    // up an evidence-gated line). Talent turns ALSO persist verbatim
    // into card.rawAnswers before any AI call (Invariant 15); closing a
    // thread opens a contention, and the existing re-map loop answers it.
    thread: [
      {
        role: { type: String, enum: ['ai', 'talent'], required: true },
        text: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
    talentApproved: { type: Boolean, default: false },
    // Spot-check fix window (JP, Aug 6): JP tightened this line AFTER the
    // talent approved it (send → before it reached the checker). The line
    // is pulled back — the talent re-looks and re-sends, or leaves it. A
    // checker never judges text the talent didn't approve.
    needsRelook: { type: Boolean, default: false },
    verdict: { type: String, enum: ['Confirmed', 'Adjust', null], default: null },
    // Adjust: the reviewer's required note. Confirmed: the required A5
    // attestation — one line stating what the non-advocate checked.
    verdictNote: { type: String, default: null },
    verdictBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verdictAt: { type: Date, default: null },
    // A4 date anchoring: no claim is approvable without account + date or
    // period. Extracted from the talent's words at structuring, or added
    // by the talent; an unanchored line stays draft — "needs a date".
    anchorText: { type: String, default: null },
    anchorSource: { type: String, enum: ['structurer', 'talent', null], default: null },
    // A4 contention loop: the talent contests a line against its
    // traceback; the AI re-maps or explains; a mapping is never final
    // over the talent's objection. Full history kept.
    contentions: [
      {
        text: { type: String, required: true }, // the talent's objection, verbatim
        at: { type: Date, default: Date.now },
        outcome: { type: String, enum: ['remapped', 'explained', null], default: null },
        response: { type: String, default: null },
        respondedAt: { type: Date, default: null },
        attempts: { type: Number, default: 0 },
      },
    ],
    // C1: the talent's on-record defence of an adjusted claim. A reviewer
    // holding Adjust on a defended claim deadlocks the card.
    defenseStatement: { type: String, default: null },
    defendedAt: { type: Date, default: null },
    // Intent v2: concession costs more than defence — downgrading a
    // defended claim carries a stated reason (original state in audit).
    concessionReason: { type: String, default: null },
  },
  { _id: true },
);

const auditEntrySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = system (SLA worker)
    action: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const nominationSchema = new Schema(
  {
    nominees: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        name: String,
        role: String,
      },
    ],
    systemChecks: {
      advocateBlock: { type: Schema.Types.Mixed, default: null },
      exposure: { type: Schema.Types.Mixed, default: null },
    },
    // Superseded by A1 (kept for pre-amendment cards' history).
    leadDecision: {
      action: { type: String, enum: ['approve', 'reject', null], default: null },
      reason: { type: String, default: null },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },
    // A1/C3: the exposure verifier's one-line sign-off (never verdict
    // authority, never substitution). Refusal returns the pick to the
    // talent with a stated reason — Invariant 4's rejection leg, re-homed.
    exposureSignoff: {
      decision: { type: String, enum: ['confirm', 'refuse', null], default: null },
      note: { type: String, default: null }, // confirm: how they know the pick saw the work
      reason: { type: String, default: null }, // refuse: required
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },
    routedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // legacy single-route cards (pre-C2v2)
    // C2v2 (JP, Aug 6 — supersedes C2): a card fans out to one route per
    // distinct checker; each LINE has exactly one non-advocate
    // (claims[].checkerId), and each route carries its own exposure
    // check, SLA clock, chases, and escalation.
    routes: [
      {
        reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, default: '' },
        // plain-language: how this pick cleared ('auto-verified — …',
        // 'signed off', 'backup path') or 'awaiting sign-off'.
        exposure: { type: String, default: null },
        signoff: {
          decision: { type: String, enum: ['confirm', 'refuse', null], default: null },
          note: { type: String, default: null },
          reason: { type: String, default: null },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, default: null },
        },
        routedAt: { type: Date, default: null }, // A5: this route's SLA clock
        chases: [
          {
            at: { type: Date, default: Date.now },
            kind: { type: String, enum: ['auto-chase', 'manual-nudge'] },
            by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          },
        ],
        reassignedFrom: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        reassignedAt: { type: Date, default: null },
        escalated: { type: String, enum: ['refused-after-ruling', 'sla', null], default: null },
        escalationHalted: { type: Schema.Types.Mixed, default: null }, // { reason, at }
        repeatStreak: { type: Number, default: 0 },
      },
    ],
    repeatStreak: { type: Number, default: 0 },
    thinPool: { type: Boolean, default: false }, // FR-15: exception path, visibly marked
    // A5 SLA: the clock starts at routing and restarts on re-route or
    // reassignment. Chases are recorded events (auto or JP's manual nudge).
    routedAt: { type: Date, default: null },
    chases: [
      {
        at: { type: Date, default: Date.now },
        kind: { type: String, enum: ['auto-chase', 'manual-nudge'] },
        by: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
      },
    ],
    // C1/A5 escalation: who the card left, when, and why — or why it
    // could NOT escalate (fallback unset/excluded → surfaces to JP).
    reassignedFrom: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reassignedAt: { type: Date, default: null },
    escalated: { type: String, enum: ['refused-after-ruling', 'sla', null], default: null },
    escalationHalted: { type: Schema.Types.Mixed, default: null }, // { reason, at }
  },
  { _id: false },
);

const cardSchema = new Schema(
  {
    talentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    track: { type: String, enum: TRACK_KEYS, required: true },
    subject: {
      name: { type: String, default: '' },
      kind: { type: String, enum: ['account', 'project'], required: true },
    },
    closeDate: { type: Date, default: null },
    filedDate: { type: Date, default: null },
    periodTag: { type: String, default: null }, // quarter of closeDate, Asia/Manila (FR-4)
    status: { type: String, enum: CARD_STATUSES, default: 'draft', index: true },
    captureMode: { type: String, enum: ['guided', 'single-pass', 'conversation', null], default: null },
    // B7: the capture conversation. Talent turns ALSO persist into
    // rawAnswers verbatim the moment they are sent (Invariant 15) —
    // which is what makes quotes talent-only: the FR-10 verbatim check
    // reads rawAnswers, and AI turns never enter it.
    conversation: [
      {
        role: { type: String, enum: ['ai', 'talent'], required: true },
        kind: { type: String, enum: ['question', 'sweep', 'wrap', 'answer'], default: null },
        text: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
    rawAnswers: [
      {
        questionIndex: Number,
        question: String,
        answer: String,
        at: { type: Date, default: Date.now },
      },
    ],
    sweepAnswers: [
      {
        prompt: String,
        answer: String,
        at: { type: Date, default: Date.now },
      },
    ],
    followUps: [
      {
        question: String,
        answer: { type: String, default: null },
        at: { type: Date, default: Date.now },
      },
    ],
    claims: [claimSchema],
    // A4: "signal noted, not claimed" — upward signals the talent chose
    // not to claim. Recorded, visible to the reviewer, resurfaced at
    // Endorsement Review (C9 hook). Never a penalty.
    // JP (Aug 6): every signal POINTS AT a competency — nothing floats.
    // It renders on that competency's line (or under its name in the
    // claim-more area) and claiming it feeds that same competency.
    signalsNoted: [
      {
        signal: { type: String, required: true },
        sourceQuote: { type: String, required: true }, // verbatim, validated
        competencyOrDomain: { type: String, default: null }, // from the pack list; null only on legacy cards
        // The talent's answer, on record: claimed it, or said not-mine
        // (hidden from their view then — but never erased; the checker
        // and Endorsement Review still see it, with the answer).
        talentSaid: { type: String, enum: ['claimed', 'not-mine', null], default: null },
        at: { type: Date, default: Date.now },
      },
    ],
    // C2v2: bolt-in / signal-claim threads — the talent taps a bolt-in
    // from the full list (or an unclaimed signal) and a small contextual
    // chat gathers enough for the structurer to draft a line. Talent
    // turns persist verbatim into rawAnswers first (Invariant 15); the
    // structuring happens in the worker, never in the request path.
    boltInThreads: [
      {
        competency: { type: String, default: null }, // null on a signal thread until the structurer maps it
        fromSignal: { type: String, default: null }, // the signal text, when opened from "we also noticed"
        thread: [
          {
            role: { type: String, enum: ['ai', 'talent'], required: true },
            text: { type: String, required: true },
            at: { type: Date, default: Date.now },
          },
        ],
        status: { type: String, enum: ['open', 'structuring', 'done', 'nothing'], default: 'open' },
        response: { type: String, default: null }, // plain-language outcome shown to the talent
        attempts: { type: Number, default: 0 },
        at: { type: Date, default: Date.now },
      },
    ],
    productionRecord: [{ type: Schema.Types.Mixed }],
    honestGap: { type: String, default: null }, // talent's own words only (FR-19)
    nomination: { type: nominationSchema, default: () => ({}) },
    packVersion: { type: String, default: null }, // Invariant 1: records the pack that structured it
    behaviorSpecVersion: { type: String, default: null }, // A7: and the behavior spec, in split mode
    createdViaShellBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // FR-5
    submittedForStructuringAt: { type: Date, default: null },
    structuringAttempts: { type: Number, default: 0 },
    structuringError: { type: String, default: null },
    nextStructuringAttemptAt: { type: Date, default: null },
    // FR-11: while calibration mode is on, structured cards hold for admin
    // review before the talent sees the claims.
    calibrationHold: { type: Boolean, default: false },
    calibrationCorrections: { type: Number, default: 0 }, // GATE-1: a clean card has zero
    calibrationReleasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    calibrationReleasedAt: { type: Date, default: null },
    // C1: JP's ruling on a deadlocked card — guidance on the record,
    // never a verdict (Invariant 3 untouched; the verdict field still
    // rejects JP).
    ruling: {
      type: new Schema(
        {
          text: { type: String, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          at: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: null,
    },
    deadlockedAt: { type: Date, default: null },
    // A5/C9 hook: "Confirmed — packaging deferred". Endorsement Review
    // (manual, JP-held) may defer compensation packaging; the confirmed
    // level is always recorded and never erased. Status stays 'confirmed'.
    packagingDeferredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    packagingDeferredAt: { type: Date, default: null },
    // A4 draft lifecycle: what status the card archived from (only
    // 'draft' archives may revive) and the one pre-expiry nudge.
    archivedFrom: { type: String, default: null },
    archiveNudgeAt: { type: Date, default: null },
    audit: [auditEntrySchema],
  },
  { timestamps: true },
);

cardSchema.index({ talentId: 1, status: 1 });
cardSchema.index({ 'nomination.routedTo': 1, status: 1 });
cardSchema.index({ 'nomination.routes.reviewerId': 1, status: 1 });

export const Card = mongoose.model('Card', cardSchema);
