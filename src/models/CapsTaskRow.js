/**
 * caps_task_rows — the CAPS mirror, WHITELIST ONLY (Amendment 1 §A2).
 *
 * This schema IS the hard wall: task name, category, project,
 * contributor, reviewer names, date, week. Nothing else exists here —
 * no weights, no scores, no difficulty, no credit fractions, no bands,
 * no totals. Value data is dropped at the import boundary, not
 * filtered later; a field that isn't named below cannot be stored.
 *
 * CAPS data is a memory scaffold and a verification source, never
 * evidence. Review count is never review authority.
 */

import mongoose from 'mongoose';

const capsTaskRowSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, index: true },
    taskName: { type: String, required: true },
    category: { type: String, default: null },
    projectName: { type: String, required: true },
    contributorName: { type: String, required: true },
    // The name-valued review columns only (never their numeric twins).
    reviewers: [
      {
        type: { type: String },
        name: { type: String },
      },
    ],
    date: { type: Date, default: null },
    week: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

capsTaskRowSchema.index({ contributorName: 1, projectName: 1 });
capsTaskRowSchema.index({ projectName: 1 });

export const CapsTaskRow = mongoose.model('CapsTaskRow', capsTaskRowSchema, 'caps_task_rows');

/** Import batch history — metadata only, no task data. */
const capsImportBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    rowCount: { type: Number, required: true },
    droppedColumns: [{ type: String }], // named for the audit trail — never stored
    windowStart: { type: Date, default: null },
    windowEnd: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const CapsImportBatch = mongoose.model('CapsImportBatch', capsImportBatchSchema, 'caps_import_batches');
