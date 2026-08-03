/**
 * Card status machine — server-enforced transitions only (Plan §3).
 * Every transition is audited (embedded + global). Any move not in
 * CARD_STATUS_TRANSITIONS is a 409, whoever asks.
 */

import { CARD_STATUS_TRANSITIONS } from '../config/constants.js';
import { conflict } from '../utils/httpError.js';
import { pushCardAudit, recordAudit } from './auditService.js';

export function canTransition(from, to) {
  return (CARD_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** Mutates card.status with audit; does not save — caller saves. */
export async function transition(card, toStatus, actorId, note = null, requestId = null) {
  const from = card.status;
  if (!canTransition(from, toStatus)) {
    throw conflict(`Illegal card status transition: ${from} → ${toStatus}`);
  }
  card.status = toStatus;
  pushCardAudit(card, { by: actorId, action: 'status-transition', before: from, after: toStatus, note });
  await recordAudit({
    actorId,
    action: 'card.status-transition',
    entity: 'card',
    entityId: card._id,
    before: { status: from },
    after: { status: toStatus },
    requestId,
  });
  return card;
}
