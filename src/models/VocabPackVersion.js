/**
 * vocab_pack_versions { trackKey, version, packText, createdAt } —
 * immutable, append-only (Plan §3, Invariant 1).
 *
 * Immutability is enforced here by rejecting every update/delete path
 * mongoose exposes. Publishing a new version inserts a new document and
 * points the track at it; nothing ever rewrites an existing one.
 */

import mongoose from 'mongoose';
import { TRACK_KEYS } from '../config/constants.js';

const vocabPackVersionSchema = new mongoose.Schema(
  {
    trackKey: { type: String, enum: TRACK_KEYS, required: true },
    version: { type: String, required: true },
    packText: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

vocabPackVersionSchema.index({ trackKey: 1, version: 1 }, { unique: true });

const IMMUTABLE = 'vocab_pack_versions are immutable (Invariant 1)';
for (const op of [
  'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate',
  'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany',
]) {
  vocabPackVersionSchema.pre(op, function block() {
    throw new Error(IMMUTABLE);
  });
}
vocabPackVersionSchema.pre('save', function blockModify() {
  if (!this.isNew) throw new Error(IMMUTABLE);
});

export const VocabPackVersion = mongoose.model(
  'VocabPackVersion',
  vocabPackVersionSchema,
  'vocab_pack_versions',
);
