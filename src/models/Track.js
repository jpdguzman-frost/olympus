/**
 * tracks { key, vocabPackVersion, packText, questionSet[4],
 *          competencyOrDomainList[], fallbackReviewerId } — Plan §3.
 *
 * packText/competencyOrDomainList arrive from the versioned vocab packs
 * (Invariant 1: the model is upstream — the app never invents vocabulary).
 * fallbackReviewerId stays null until OD-2 is decided (config, not code).
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
    // Machine-readable controlled vocabulary from the pack: {labelField: [allowed values]}.
    // The FR-10 validation layer fails closed when this is empty.
    controlledVocabulary: { type: mongoose.Schema.Types.Mixed, default: {} },
    fallbackReviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    calibrationMode: { type: Boolean, default: true }, // FR-11; exits via GATE-1 (JP-owned)
  },
  { timestamps: true },
);

export const Track = mongoose.model('Track', trackSchema);
