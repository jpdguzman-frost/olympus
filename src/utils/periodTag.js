/**
 * FR-4: period tag = quarter of the close date, regardless of filing date.
 * NFR-5: computed in Asia/Manila regardless of server timezone.
 */

import { APP_TIMEZONE } from '../config/constants.js';

const manilaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
});

/** @param {Date} closeDate @returns {string|null} e.g. "2026-Q1" */
export function periodTagFor(closeDate) {
  if (!closeDate || Number.isNaN(new Date(closeDate).getTime())) return null;
  const parts = manilaParts.formatToParts(new Date(closeDate));
  const year = parts.find((p) => p.type === 'year').value;
  const month = Number(parts.find((p) => p.type === 'month').value);
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}
