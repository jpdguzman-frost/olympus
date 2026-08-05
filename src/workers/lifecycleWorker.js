/**
 * A4 draft lifecycle — drafts idle 90 days ARCHIVE, never delete.
 * One nudge a week before; revivable from archive any time. Raw
 * answers are untouched throughout (Invariant 15).
 *
 * "Idle" = not touched (updatedAt). Submitted drafts waiting on
 * structuring never archive — they are in flight, not idle.
 */

import { Card } from '../models/Card.js';
import { pushCardAudit, recordAudit } from '../services/auditService.js';
import { transition } from '../services/statusMachine.js';
import { DRAFT_ARCHIVE_DAYS, DRAFT_NUDGE_DAYS } from '../config/constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // four times a day is plenty

let timer = null;

export function startLifecycleWorker({ intervalMs = POLL_INTERVAL_MS } = {}) {
  timer = setInterval(() => {
    runLifecyclePass().catch((err) => console.error('[lifecycle] pass failed', err));
  }, intervalMs);
  console.log('Lifecycle worker watching idle drafts');
}

export function stopLifecycleWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runLifecyclePass({ now = new Date() } = {}) {
  const outcomes = [];
  const idleDrafts = await Card.find({
    status: 'draft',
    submittedForStructuringAt: null,
    updatedAt: { $lte: new Date(now.getTime() - DRAFT_NUDGE_DAYS * DAY_MS) },
  });

  for (const card of idleDrafts) {
    const idleDays = Math.floor((now - card.updatedAt) / DAY_MS);

    if (idleDays >= DRAFT_ARCHIVE_DAYS) {
      card.archivedFrom = 'draft';
      pushCardAudit(card, {
        by: null,
        action: 'draft-archived',
        note: `idle ${idleDays} days — archived, never deleted; revive any time (A4)`,
      });
      await transition(card, 'archived', null, 'idle draft archived — nothing is lost');
      await card.save();
      await recordAudit({
        actorId: null, action: 'card.draft-archived', entity: 'card', entityId: card._id,
        after: { idleDays },
      });
      outcomes.push({ cardId: card._id, outcome: 'archived' });
    } else if (!card.archiveNudgeAt) {
      // The ONE pre-expiry nudge (A4). Surfaces on the talent's home.
      card.archiveNudgeAt = now;
      pushCardAudit(card, { by: null, action: 'archive-nudge', note: `idle ${idleDays} days — archives at ${DRAFT_ARCHIVE_DAYS}` });
      // save() bumps updatedAt, which would reset the idle clock — write
      // the nudge without touching timestamps.
      await Card.collection.updateOne(
        { _id: card._id },
        { $set: { archiveNudgeAt: now, audit: card.audit.map((a) => a.toObject?.() ?? a) } },
      );
      await recordAudit({
        actorId: null, action: 'card.archive-nudge', entity: 'card', entityId: card._id,
        after: { idleDays },
      });
      outcomes.push({ cardId: card._id, outcome: 'nudged' });
    }
  }
  return outcomes;
}
