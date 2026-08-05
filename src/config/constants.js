/** Shared constants. */

export const DEFAULT_PORT = 4600;

/** NFR-5: all dates and period tags are computed in Asia/Manila. */
export const APP_TIMEZONE = 'Asia/Manila';

export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/** Track keys are fixed for v1; the data model must not preclude new ones. */
export const TRACK_KEYS = ['ops', 'artasset'];

export const ROLES = ['talent', 'lead', 'nonadvocate', 'admin'];

/**
 * Card status machine (Plan §3 + Ruling C1) — server-enforced transitions
 * only. Key = from-status, value = the set of statuses reachable from it.
 * adjust → revised is the "back to talent" leg; revised → routed is re-route.
 *
 * C1 deadlock legs: routed → deadlocked (reviewer holds Adjust on a
 * defended claim) → ruled (JP writes a ruling — guidance, never a
 * verdict) → the reviewer writes the verdict themselves (confirmed |
 * adjust) or refuses → reassigned (fallback reviewer, OD-2 setting) →
 * the fallback writes the verdict. routed → reassigned is the SLA
 * escalation leg (A5: two chases, then auto-escalation).
 */
export const CARD_STATUS_TRANSITIONS = {
  draft: ['structured'],
  structured: ['talent-approved'],
  'talent-approved': ['lead-nominee-review'],
  'lead-nominee-review': ['routed', 'talent-approved'], // reject returns the pick to the talent (FR-14)
  routed: ['confirmed', 'adjust', 'deadlocked', 'reassigned'],
  deadlocked: ['ruled'],
  ruled: ['confirmed', 'adjust', 'reassigned'],
  reassigned: ['confirmed', 'adjust'],
  adjust: ['revised'],
  revised: ['routed'],
  confirmed: ['archived'],
  archived: [],
};

export const CARD_STATUSES = Object.keys(CARD_STATUS_TRANSITIONS);

/**
 * BR-1: flag vocabulary is fixed per pack. The server rejects any flag
 * outside this list (Invariant 1 — the app never invents vocabulary).
 */
export const FLAG_VOCABULARY = [
  'NEEDS-OWNER',
  'COULD-BE-HIGHER',
  'NEEDS-2A',
  'NEEDS-INVOLVEMENT',
  'FLOOR-BLOCKS-CLIMB',
  'STALE',
  'PROPOSED-BOLT-IN',
  'THIN-POOL',
  'NOT-TRIGGERED',
  'NOT-CLAIMED',
];

/**
 * A5 verdict SLA — working days (Asia/Manila, Mon–Fri), measured from
 * routing (clock restarts on re-route/reassignment). Two automatic
 * chases, then auto-escalation to the track's fallback reviewer.
 * Non-response is never a verdict.
 */
export const SLA_CHASE_1_DAYS = 5;
export const SLA_CHASE_2_DAYS = 8;
export const SLA_ESCALATE_DAYS = 10;

/** BR-4: cards filed 60+ days after close carry STALE (context, never a block). */
export const STALE_THRESHOLD_DAYS = 60;

/** FR-21: nudge threshold — closed 30+ days with no card started. */
export const NUDGE_THRESHOLD_DAYS = 30;
