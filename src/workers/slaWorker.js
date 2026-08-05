/**
 * A5 verdict SLA worker — 10 working days (Asia/Manila, Mon–Fri), two
 * automatic chases, then auto-escalation to the track's fallback
 * reviewer (the OD-2 setting, read at escalation time).
 *
 * Non-response is NEVER a verdict: escalation reassigns, it never
 * decides. Halted escalations (fallback unset/excluded) surface on JP's
 * pending-verdict dashboard and are retried on later passes only after
 * the setting changes.
 *
 * Clock: nomination.reassignedAt || nomination.routedAt — restarts on
 * re-route and reassignment. Statuses covered: routed (normal review)
 * and ruled (reviewer sitting on JP's ruling). A reassigned card gets
 * chases but no second auto-escalation — a stuck fallback is JP's call,
 * visible on the dashboard.
 */

import { Card } from '../models/Card.js';
import { escalateToFallback } from '../services/verdictService.js';
import { pushCardAudit, recordAudit } from '../services/auditService.js';
import { workingDaysBetween } from '../utils/workingDays.js';
import { SLA_CHASE_1_DAYS, SLA_CHASE_2_DAYS, SLA_ESCALATE_DAYS } from '../config/constants.js';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly — the SLA moves in days

let timer = null;
let running = false;

export function startSlaWorker({ intervalMs = POLL_INTERVAL_MS } = {}) {
  timer = setInterval(() => {
    runSlaPass().catch((err) => console.error('[sla] pass failed', err));
  }, intervalMs);
  console.log('SLA worker watching pending verdicts');
}

export function stopSlaWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runSlaPass({ now = new Date() } = {}) {
  if (running) return [];
  running = true;
  const outcomes = [];
  try {
    const cards = await Card.find({
      status: { $in: ['routed', 'ruled', 'reassigned'] },
      'nomination.routedTo': { $ne: null },
    });

    for (const card of cards) {
      if (card.nomination.escalationHalted) continue; // JP resolves manually
      const clockStart = card.nomination.reassignedAt || card.nomination.routedAt;
      if (!clockStart) continue;
      const aged = workingDaysBetween(clockStart, now);
      const autoChases = (card.nomination.chases || []).filter(
        (c) => c.kind === 'auto-chase' && c.at >= clockStart,
      ).length;

      if (aged >= SLA_ESCALATE_DAYS && autoChases >= 2 && card.status !== 'reassigned') {
        pushCardAudit(card, {
          by: null,
          action: 'sla-escalation',
          note: `${aged} working days without a verdict after two chases — escalating (A5)`,
        });
        await escalateToFallback(card, 'sla', null);
        outcomes.push({ cardId: card._id, outcome: 'escalated' });
      } else if (
        (aged >= SLA_CHASE_2_DAYS && autoChases === 1) ||
        (aged >= SLA_CHASE_1_DAYS && autoChases === 0)
      ) {
        card.nomination.chases.push({ kind: 'auto-chase', by: null, at: now });
        pushCardAudit(card, {
          by: null,
          action: 'auto-chase',
          note: `${aged} working days without a verdict (chase ${autoChases + 1} of 2)`,
        });
        await card.save();
        await recordAudit({
          actorId: null,
          action: 'card.auto-chase',
          entity: 'card',
          entityId: card._id,
          after: { agedWorkingDays: aged, chase: autoChases + 1 },
        });
        outcomes.push({ cardId: card._id, outcome: `chase-${autoChases + 1}` });
      }
    }
  } finally {
    running = false;
  }
  return outcomes;
}
