/**
 * P5 parity fixtures (AC-2..AC-4): the reference records from the two
 * live sheets, replayed through the derivation. The sheets are the
 * reference implementation; GATE-2 is JP confirming these reads match.
 *
 * AC-2 — Karen Ong's confirmed Ops record reproduces exactly.
 * AC-3 — Gwyn Cristo's record: disqualified direction entries stay
 *        disqualified; Adjust feedback outcomes match.
 * AC-4 — zero inflation: no derived read exceeds the sheet record.
 */

import { describe, it, expect } from 'vitest';
import { deriveOps, deriveArtasset, opsTier } from '../src/services/readerService.js';

const CHECKED = 'My work is being checked by someone else';
const OWNS = 'I fully own the work — no one checks behind me';
const DELEGATES = 'I own the work but delegates it to someone else';
const EXECUTED = 'I executed the decision given to me';
const PROPOSED = 'I proposed and someone decided';
const DECIDED_OVERTURNABLE = 'I made the decision, but someone above me could overturn it';

function ops(comp, execution, decision, type = 'core') {
  return {
    claim: { type, competencyOrDomain: comp, labels: { execution, decision }, sourceQuote: 'sheet row', verdict: 'Confirmed' },
    subjectName: 'reference',
  };
}

// Karen Ong — Design Ops Competency Self-Map, confirmed record (26 rows).
const KAREN = [
  ops('Pipeline & Board Management', CHECKED, EXECUTED),
  ops('Pipeline & Board Management', CHECKED, EXECUTED),
  ops('Pipeline & Board Management', OWNS, PROPOSED),
  ops('Request intake & filing', CHECKED, EXECUTED),
  ops('Request intake & filing', CHECKED, EXECUTED),
  ops('Request intake & filing', OWNS, EXECUTED),
  ops('Revision tracking', CHECKED, EXECUTED),
  ops('Revision tracking', CHECKED, EXECUTED),
  ops('Revision tracking', OWNS, EXECUTED),
  ops('Status & blockers', CHECKED, EXECUTED),
  ops('Status & blockers', CHECKED, EXECUTED),
  ops('Status & blockers', OWNS, EXECUTED),
  ops('Workflow & file management', CHECKED, PROPOSED),
  ops('Workflow & file management', CHECKED, EXECUTED),
  ops('Workflow & file management', OWNS, EXECUTED),
  ops('Meeting facilitation', CHECKED, EXECUTED),
  ops('Meeting facilitation', DELEGATES, DECIDED_OVERTURNABLE), // the J2 → Mid row
  ops('Cross-functional coordination', CHECKED, EXECUTED),
  ops('Cross-functional coordination', CHECKED, EXECUTED),
  ops('Cross-functional coordination', CHECKED, EXECUTED),
  ops('Reliability', null, null, 'holding'),
  ops('Reliability', null, null, 'holding'),
  ops('Reliability', null, null, 'holding'),
  ops('Operational resiliency', null, PROPOSED, 'holding'),
  ops('Operational resiliency', null, PROPOSED, 'holding'),
  ops('Team onboarding', OWNS, EXECUTED, 'bolt-in'),
];

describe('AC-2: Karen Ong parity (Ops)', () => {
  it('reads J2 → Mid off the Meeting facilitation pair, exactly as the sheet does', () => {
    const read = deriveOps(KAREN);
    expect(read.level).toBe('J2 → Mid');
    expect(read.basis.competency).toBe('Meeting facilitation');
  });

  it('reliability floor reads Met', () => {
    expect(deriveOps(KAREN).floor).toBe('Met');
  });

  it('resiliency proposals never lift the level (sheet: "Call not owned")', () => {
    const withoutMeetingRow = KAREN.filter(
      (e) => !(e.claim.competencyOrDomain === 'Meeting facilitation' && e.claim.labels.execution === DELEGATES),
    );
    const read = deriveOps(withoutMeetingRow);
    expect(read.level).toBe('J1'); // resiliency (proposed) contributes nothing upward
    expect(read.notes.some((n) => n.includes('call not owned'))).toBe(true);
  });

  it('AC-4 zero inflation: every observed pair maps at or below the sheet tier', () => {
    expect(opsTier(1, 0)).toMatchObject({ tier: 'J1', rank: 1 });
    expect(opsTier(2, 0)).toMatchObject({ tier: 'J1', rank: 1 });
    expect(opsTier(2, 1)).toMatchObject({ tier: 'J1', rank: 1 });
    expect(opsTier(3, 2)).toMatchObject({ tier: 'J2 → Mid', rank: 2 });
  });

  it('bolt-ins sit beside the level and never move it', () => {
    const boltInsOnly = KAREN.filter((e) => e.claim.type === 'bolt-in');
    expect(deriveOps(boltInsOnly).level).toBe(null);
  });
});

// ---------------------------------------------------------------------------

const FLOOR_REFINED = 'No. Someone refines my work before it goes out.';
const FLOOR_OVERTURNABLE = 'Yes. My work goes out as is, but someone can overturn, rework or refine it.';
const FLOOR_LATE = 'Yes. And I refine other people\'s work.';
const DIR_FOLLOWED = 'I followed an existing direction.';
const DIR_EXPANDED = 'I expanded an existing direction.';
const DIR_SET = 'I set the direction for this work, from an existing system and style.';
const DIR_CREATED_NOT_USED = 'I created the direction. It was not used.';

function aa(comp, floor, direction, subjectName, type = 'work') {
  return {
    claim: { type, competencyOrDomain: comp, labels: { floor, direction }, sourceQuote: 'sheet row', verdict: 'Confirmed' },
    subjectName,
  };
}

// Gwyn Cristo — Art & Asset Self Map, confirmed record (representative
// rows incl. the two Cascade rows JP's Adjust feedback corrected to
// "set the direction ... from an existing system and style").
const GWYN = [
  aa('Seed', FLOOR_LATE, DIR_FOLLOWED, 'Jollibee Always-On Journeys 1–10'),
  aa('Seed', FLOOR_LATE, DIR_EXPANDED, 'Chowking Always-On Journeys 1–10'),
  aa('Seed', FLOOR_OVERTURNABLE, DIR_EXPANDED, 'Sustainability Report Cover'),
  aa('Sketch', FLOOR_OVERTURNABLE, DIR_FOLLOWED, 'GCash: Sustainability Report'),
  aa('Sketch', FLOOR_OVERTURNABLE, DIR_FOLLOWED, 'Jollibee Always-On Journeys 1–10'),
  aa('Cascade', FLOOR_OVERTURNABLE, DIR_FOLLOWED, 'Jollibee Always-On Journeys 1–10'),
  aa('Cascade', FLOOR_LATE, DIR_SET, 'Chowking Always-On Journeys 1–10'), // post-Adjust correction
  aa('Cascade', FLOOR_LATE, DIR_SET, 'Jollibee One-Off Campaigns'), // post-Adjust correction
  aa('Review', null, null, 'Jollibee One-Off Campaigns', 'gate'),
];

describe('AC-3: Gwyn Cristo parity (A&A)', () => {
  it('reads Mid · Late off the corrected Cascade rows (the Levels table cell)', () => {
    const read = deriveArtasset(GWYN);
    expect(read.level).toBe('Mid');
    expect(read.texture).toBe('Late');
  });

  it('review is a gate — it never feeds the read', () => {
    const gatesOnly = GWYN.filter((e) => e.claim.type === 'gate');
    expect(deriveArtasset(gatesOnly).level).toBe(null);
  });

  it('a disqualified direction stays disqualified: refined-before-out is Below floor whatever the idea was', () => {
    const read = deriveArtasset([
      aa('Sketch', FLOOR_REFINED, DIR_CREATED_NOT_USED, 'GLife: App Support: Screens'),
    ]);
    expect(read.level).toBe(null); // nothing stands
    expect(read.notes[0]).toMatch(/Below floor/);
  });

  it('level 4+ without confirmed Part 2a from-scratch material caps at Mid (NEEDS-2A)', () => {
    const read = deriveArtasset([
      aa('Sketch', FLOOR_LATE, DIR_CREATED_NOT_USED, 'Some New Project'),
    ]);
    expect(read.level).toBe('Mid');
    expect(read.notes.some((n) => n.includes('NEEDS-2A'))).toBe(true);
  });

  it('level 4+ can never come through GCash Design Support', () => {
    const read = deriveArtasset([
      aa('Sketch', FLOOR_LATE, DIR_CREATED_NOT_USED, 'GCash Design Support'),
      { claim: { type: 'direction', competencyOrDomain: 'Direction Setting', labels: { directionExisted: 'No' }, sourceQuote: 'x', verdict: 'Confirmed' }, subjectName: 'GCash Design Support' },
    ]);
    expect(read.level).toBe('Mid');
    expect(read.notes.some((n) => n.includes('never from scratch'))).toBe(true);
  });

  it('with confirmed 2a from-scratch material, a created direction reads Senior', () => {
    const read = deriveArtasset([
      aa('Sketch', FLOOR_LATE, DIR_CREATED_NOT_USED, 'Fresh Project'),
      { claim: { type: 'direction', competencyOrDomain: 'Direction Setting', labels: { directionExisted: 'No' }, sourceQuote: 'x', verdict: 'Confirmed' }, subjectName: 'Fresh Project' },
    ]);
    expect(read.level).toBe('Senior');
    expect(read.texture).toBe('Late');
  });
});
