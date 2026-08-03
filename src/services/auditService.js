/**
 * Append-only audit recording (Invariant 17). Called by every mutation
 * path; card mutations ALSO push an embedded card.audit entry so a card
 * carries its own history (the caller passes the card, one save).
 */

import { AuditLog } from '../models/AuditLog.js';

export async function recordAudit({ actorId, action, entity, entityId, before = null, after = null, requestId = null }) {
  await AuditLog.create({ actorId, action, entity, entityId, before, after, requestId });
}

/** Push an embedded audit entry onto a card (does not save — caller saves). */
export function pushCardAudit(card, { by, action, before = null, after = null, note = null }) {
  card.audit.push({ at: new Date(), by, action, before, after, note });
}
