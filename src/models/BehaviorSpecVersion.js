/**
 * behavior_spec_versions { trackKey, version, text, createdAt } —
 * immutable, append-only (Amendment 1 §A7 / Build plan B1).
 *
 * The behavior spec is the AI's capture/structuring behavior (Intent v2),
 * stored as versioned DATA — never hard-coded (A7: CALIBRATING; the
 * verbatim port is re-published at GATE-1). Same immutability posture as
 * vocab packs: publishing inserts a new document and points the track at
 * it; nothing ever rewrites an existing one.
 */

import mongoose from 'mongoose';
import { TRACK_KEYS } from '../config/constants.js';

const behaviorSpecVersionSchema = new mongoose.Schema(
  {
    trackKey: { type: String, enum: TRACK_KEYS, required: true },
    version: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

behaviorSpecVersionSchema.index({ trackKey: 1, version: 1 }, { unique: true });

const IMMUTABLE = 'behavior_spec_versions are immutable (A7: versioned, never edited)';
for (const op of [
  'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate',
  'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany',
]) {
  behaviorSpecVersionSchema.pre(op, function block() {
    throw new Error(IMMUTABLE);
  });
}
behaviorSpecVersionSchema.pre('save', function blockModify() {
  if (!this.isNew) throw new Error(IMMUTABLE);
});

export const BehaviorSpecVersion = mongoose.model(
  'BehaviorSpecVersion',
  behaviorSpecVersionSchema,
  'behavior_spec_versions',
);
