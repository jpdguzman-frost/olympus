/**
 * Status machine: only Plan §3 transitions — as amended by A1 (exposure
 * sign-off replaces lead nominee review) and C1 (deadlock legs) — are
 * legal, and each is audited.
 */

import { describe, it, expect } from 'vitest';
import { canTransition } from '../src/services/statusMachine.js';

describe('card status machine (Plan §3 as amended)', () => {
  const legal = [
    ['draft', 'structured'],
    ['structured', 'talent-approved'],
    ['talent-approved', 'exposure-signoff'], // A1: pick goes for a sign-off
    ['talent-approved', 'routed'], // thin pool now; CAPS auto-verify in B5
    ['exposure-signoff', 'routed'],
    ['exposure-signoff', 'talent-approved'], // C3: refusal returns the pick
    ['routed', 'confirmed'],
    ['routed', 'adjust'],
    ['routed', 'deadlocked'], // C1: reviewer holds on a defended claim
    ['routed', 'reassigned'], // A5: SLA escalation
    ['deadlocked', 'ruled'],
    ['ruled', 'confirmed'],
    ['ruled', 'adjust'],
    ['ruled', 'reassigned'],
    ['reassigned', 'confirmed'],
    ['reassigned', 'adjust'],
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
    ['structured', 'exposure-signoff'],
    ['talent-approved', 'lead-nominee-review'], // A1: the lead leg is retired
    ['lead-nominee-review', 'routed'], // the retired state has no legs at all
    ['confirmed', 'draft'], // confirmed never reopens
    ['archived', 'draft'],
    ['adjust', 'confirmed'], // adjust must go back through the talent
    ['adjust', 'routed'], // ...and re-route only after revision
    ['adjust', 'deadlocked'], // deadlock only fires at verdict time
    ['deadlocked', 'confirmed'], // a deadlock resolves only through a ruling
    ['deadlocked', 'reassigned'], // ...and reassignment only after refusal
    ['reassigned', 'deadlocked'], // no second deadlock — JP resolves by hand
  ];

  it.each(illegal)('%s → %s is rejected', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
