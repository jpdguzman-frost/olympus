/**
 * audit_logs — global append-only audit trail (Invariant 17, NFR-2).
 * Every state change, edit, approval, rejection, and verdict:
 * who, what, when, before/after. Insert-only; every mutation path throws.
 */

import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

const APPEND_ONLY = 'audit_logs is append-only (Invariant 17)';
for (const op of [
  'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate',
  'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany',
]) {
  auditLogSchema.pre(op, function block() {
    throw new Error(APPEND_ONLY);
  });
}
auditLogSchema.pre('save', function blockModify() {
  if (!this.isNew) throw new Error(APPEND_ONLY);
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema, 'audit_logs');
