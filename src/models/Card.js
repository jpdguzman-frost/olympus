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
    talentApproved: { type: Boolean, default: false },
    verdict: { type: String, enum: ['Confirmed', 'Adjust', null], default: null },
    // Adjust: the reviewer's required note. Confirmed: the required A5
    // attestation — one line stating what the non-advocate checked.
    verdictNote: { type: String, default: null },
    verdictBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verdictAt: { type: Date, default: null },
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
    leadDecision: {
      action: { type: String, enum: ['approve', 'reject', null], default: null },
      reason: { type: String, default: null }, // required on reject (FR-14)
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },
    routedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
    captureMode: { type: String, enum: ['guided', 'single-pass', null], default: null },
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
    audit: [auditEntrySchema],
  },
  { timestamps: true },
);

cardSchema.index({ talentId: 1, status: 1 });
cardSchema.index({ 'nomination.routedTo': 1, status: 1 });

export const Card = mongoose.model('Card', cardSchema);
