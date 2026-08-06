/**
 * tracks { key, vocabPackVersion, packText, questionSet[4],
 *          competencyOrDomainList[], fallbackReviewerId } — Plan §3.
 *
 * packText/competencyOrDomainList arrive from the versioned vocab packs
 * (Invariant 1: the model is upstream — the app never invents vocabulary).
 *
 * Split mode (Amendment 1 §A7, from Ops pack v0.4): packMode 'vocab-only'
 * means the pack carries vocabulary/schema only and structuring composes
 * behaviorSpecText (versioned, admin-published, never hard-coded) with the
 * pack. packMode 'legacy' = the pack is the whole system prompt (A&A until
 * its v0.4 arrives).
 *
 * fallbackReviewerId / exposureVerifierId are admin-assignable role
 * settings (Ruling OD-2): configured in the admin UI, changeable without
 * deploy, read at use time. Both stay null until set at pilot.
 */

import mongoose from 'mongoose';
import { TRACK_KEYS } from '../config/constants.js';

const trackSchema = new mongoose.Schema(
  {
    key: { type: String, enum: TRACK_KEYS, required: true, unique: true },
    label: { type: String, required: true },
    vocabPackVersion: { type: String, default: null },
    packText: { type: String, default: null },
    questionSet: {
      type: [String],
      validate: [(qs) => qs.length === 4, 'questionSet must contain exactly 4 questions'],
    },
    competencyOrDomainList: [{ type: String }],
    // C2v2 (JP, Aug 6): the pack's Part 3 bolt-ins, shown to the talent
    // as a full list — "they can't claim what they can't see". From the
    // pack sidecar (parts.part3BoltIns); never invented here.
    boltIns: [{ type: String }],
    // Machine-readable controlled vocabulary from the pack: {labelField: [allowed values]}.
    // The FR-10 validation layer fails closed when this is empty.
    controlledVocabulary: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Ruling C6 two-layer flags: claim-level flags from the pack (§B8) —
    // the only flags the AI may output. Empty = legacy FLAG_VOCABULARY.
    claimFlags: { type: [String], default: [] },
    packMode: { type: String, enum: ['legacy', 'vocab-only'], default: 'legacy' },
    behaviorSpecVersion: { type: String, default: null },
    behaviorSpecText: { type: String, default: null },
    fallbackReviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    exposureVerifierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    calibrationMode: { type: Boolean, default: true }, // FR-11; exits via GATE-1 (JP-owned)
  },
  { timestamps: true },
);

export const Track = mongoose.model('Track', trackSchema);
