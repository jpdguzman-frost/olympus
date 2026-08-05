/**
 * Working-day arithmetic for the A5 verdict SLA — Asia/Manila (NFR-5),
 * Monday–Friday. No holiday calendar in v1.
 */

import { APP_TIMEZONE } from '../config/constants.js';

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, weekday: 'short' });

const DAY_MS = 24 * 60 * 60 * 1000;

function isWorkingDay(date) {
  const day = weekdayFmt.format(date);
  return day !== 'Sat' && day !== 'Sun';
}

/**
 * Whole working days elapsed from `start` to `end` in Asia/Manila —
 * counts each full 24h step whose end lands on a working day.
 */
export function workingDaysBetween(start, end) {
  if (!start || !end) return 0;
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  let count = 0;
  for (let t = from + DAY_MS; t <= to; t += DAY_MS) {
    if (isWorkingDay(new Date(t))) count += 1;
    if (count > 2000) break; // runaway guard
  }
  return count;
}

/** A timestamp `n` working days before `end` — test/backdating helper. */
export function workingDaysBefore(end, n) {
  const candidate = new Date(end);
  while (workingDaysBetween(candidate, end) < n) {
    candidate.setTime(candidate.getTime() - DAY_MS);
  }
  return candidate;
}
