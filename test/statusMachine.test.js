/** Status machine: only Plan §3 transitions are legal, and each is audited. */

import { describe, it, expect } from 'vitest';
import { canTransition } from '../src/services/statusMachine.js';

describe('card status machine (Plan §3)', () => {
  const legal = [
    ['draft', 'structured'],
    ['structured', 'talent-approved'],
    ['talent-approved', 'lead-nominee-review'],
    ['lead-nominee-review', 'routed'],
    ['routed', 'confirmed'],
    ['routed', 'adjust'],
    ['adjust', 'revised'],
    ['revised', 'routed'],
    ['confirmed', 'archived'],
  ];

  it.each(legal)('%s → %s is legal', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const illegal = [
    ['draft', 'confirmed'], // no skipping to confirmed
    ['draft', 'routed'], // no skipping talent approval
    ['structured', 'routed'], // talent approves before anything routes (Invariant 5)
    ['talent-approved', 'routed'], // lead nominee review cannot be skipped
    ['confirmed', 'draft'], // confirmed never reopens
    ['archived', 'draft'],
    ['adjust', 'confirmed'], // adjust must go back through the talent
    ['adjust', 'routed'], // ...and re-route only after revision
  ];

  it.each(illegal)('%s → %s is rejected', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
