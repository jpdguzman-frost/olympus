/**
 * Reader (P5 — FR-18): level derivation, server-side, from CONFIRMED
 * claims only. Ported from the two live sheets — the sheets remain the
 * reference implementation, and GATE-2 is JP confirming parity
 * (AC-2..AC-4). Nothing here assigns a level; it reads one off the
 * evidence, exactly as the instruments do.
 *
 * Pairs and cells observed directly in the reference sheets are applied
 * as-is; combinations the sheets never exercised are marked
 * parityUnconfirmed so GATE-2 review sees exactly what was extrapolated.
 */

// ---------------------------------------------------------------------------
// Design Ops — execution × decision scoring (from the sheet's scoring tab)
// ---------------------------------------------------------------------------

export const OPS_EXEC_SCORE = {
  'My work is being checked by someone else': 1,
  'I fully own the work — no one checks behind me': 2,
  'I own the work but delegates it to someone else': 3,
};

export const OPS_DEC_SCORE = {
  'I executed the decision given to me': 0,
  'I proposed and someone decided': 1,
  'I made the decision, but someone above me could overturn it': 2,
  'The decision is fully rest on me and no one else': 3,
};

/**
 * Per-claim tier from the (execution, decision) pair.
 * Observed in Karen Ong's reference record: (1,0)(2,0)(2,1)→J1 rank 1;
 * (3,2)→"J2 → Mid" rank 2. The governing rule (Part 4 of the sheet):
 * the level follows who made the call — execution alone never lifts.
 */
export function opsTier(execScore, decScore) {
  if (decScore <= 1) return { tier: 'J1', rank: 1 };
  if (decScore === 2) {
    if (execScore >= 3) return { tier: 'J2 → Mid', rank: 2 };
    return { tier: 'J2', rank: 2, parityUnconfirmed: true };
  }
  return { tier: 'Mid', rank: 3, parityUnconfirmed: true };
}

/**
 * Derive the Ops read from confirmed claims (each entry: {claim, subjectName}).
 */
export function deriveOps(entries) {
  const notes = [];
  let best = null;

  for (const { claim } of entries) {
    if (claim.type === 'core') {
      const execScore = OPS_EXEC_SCORE[claim.labels?.execution] ?? 0;
      const decScore = OPS_DEC_SCORE[claim.labels?.decision] ?? 0;
      const tier = opsTier(execScore, decScore);
      if (tier.parityUnconfirmed) {
        notes.push(`Pair (exec ${execScore}, dec ${decScore}) was never exercised in the reference sheet — GATE-2 confirms this read`);
      }
      if (!best || tier.rank > best.rank) best = { ...tier, claim };
    } else if (claim.type === 'holding' && claim.competencyOrDomain === 'Operational resiliency') {
      const decScore = OPS_DEC_SCORE[claim.labels?.decision] ?? 0;
      if (decScore <= 1) {
        // The sheet's own honesty: "Call not owned — did not make the
        // call — doesn't lift level". Recorded, never lifting.
        notes.push('Operational resiliency: call not owned — does not lift the level');
      }
    }
  }

  // Reliability is a floor gate (Part 2): met when confirmed on record.
  const floorMet = entries.some(
    ({ claim }) => claim.type === 'holding' && claim.competencyOrDomain === 'Reliability',
  );

  return {
    track: 'ops',
    level: best ? best.tier : null,
    texture: null, // Ops texture lives inside the tier string (e.g. "J2 → Mid")
    floor: floorMet ? 'Met' : 'Not met',
    basis: best ? { competency: best.claim.competencyOrDomain, quote: best.claim.sourceQuote } : null,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Art & Asset — the Levels table, verbatim
// ---------------------------------------------------------------------------

/** Direction label → level index (sheet scoring: 1,2,3,4,4,5,6). */
export const AA_DIRECTION_LEVEL = {
  'I followed an existing direction.': 1,
  'I expanded an existing direction.': 2,
  'I set the direction for this work, from an existing system and style.': 3,
  'I created the direction. It was not used.': 4,
  'I created the direction. It was used, but someone refined it to get it out.': 4,
  'I created the direction. Everyone followed it.': 5,
  'Someone else created the direction. I steered and refined them. Theirs was used.': 6,
};

export const AA_LEVEL_NAMES = ['Below floor', 'J1', 'J2', 'Mid', 'Senior', 'Lead', 'Director'];

/** Floor state → texture; the refines-before-out row is Below floor everywhere. */
export const AA_FLOOR_TEXTURE = {
  'No. Someone refines my work before it goes out.': null,
  'Yes. My work goes out as is, but someone can overturn, rework or refine it.': 'Early',
  'Yes. My work goes out as is.': 'Settled',
  'Yes. And I refine other people\'s work.': 'Late',
};

/**
 * Derive the A&A read from confirmed claims (each entry: {claim, subjectName}).
 * Constraints from "What the table will not let you do":
 *  - refined-before-out → Below floor, whatever the idea was
 *  - level 4+ needs confirmed Part 2a from-scratch material (else capped at 3)
 *  - level 4+ can never come through GCash Design Support
 *  - Review never levels (type 'gate' is skipped for the read)
 */
export function deriveArtasset(entries) {
  const notes = [];

  const has2aFromScratch = entries.some(
    ({ claim }) =>
      claim.type === 'direction' &&
      claim.competencyOrDomain === 'Direction Setting' &&
      claim.labels?.directionExisted === 'No',
  );

  let best = null;
  for (const { claim, subjectName } of entries) {
    if (claim.type !== 'work') continue;
    const floor = claim.labels?.floor;
    const direction = claim.labels?.direction;
    if (!floor || !direction) continue;

    const texture = AA_FLOOR_TEXTURE[floor];
    if (texture === null || texture === undefined) {
      // Below floor: no direction claim can stand on this project.
      notes.push(`${claim.competencyOrDomain} on ${subjectName}: work is refined before it goes out — Below floor, direction claim cannot stand`);
      continue;
    }

    let levelIdx = AA_DIRECTION_LEVEL[direction] ?? 1;
    if (levelIdx >= 4 && /gcash design support/i.test(subjectName ?? '')) {
      levelIdx = 3;
      notes.push(`${subjectName}: GCash Design Support is never from scratch — read capped at ${AA_LEVEL_NAMES[3]}`);
    }
    if (levelIdx >= 4 && !has2aFromScratch) {
      levelIdx = 3;
      notes.push(`${claim.competencyOrDomain} on ${subjectName}: no confirmed from-scratch project in Part 2a — read capped at ${AA_LEVEL_NAMES[3]} (NEEDS-2A)`);
    }

    if (!best || levelIdx > best.levelIdx) best = { levelIdx, texture, claim, subjectName };
  }

  const floorMet = entries.some(({ claim }) => {
    const texture = AA_FLOOR_TEXTURE[claim.labels?.floor];
    return claim.type === 'work' && texture;
  });

  return {
    track: 'artasset',
    level: best ? AA_LEVEL_NAMES[best.levelIdx] : null,
    texture: best ? best.texture : null,
    floor: floorMet ? 'Met' : 'Not met',
    basis: best ? { competency: best.claim.competencyOrDomain, subject: best.subjectName, quote: best.claim.sourceQuote } : null,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Entry point: derive from a talent's confirmed cards (FR-18)
// ---------------------------------------------------------------------------

export function deriveFromCards(trackKey, confirmedCards) {
  const entries = [];
  for (const card of confirmedCards) {
    for (const claim of card.claims) {
      // Confirmed claims only feed the read (FR-18); BR-7.
      if (claim.verdict === 'Confirmed') {
        entries.push({ claim, subjectName: card.subject?.name });
      }
    }
  }
  const result = trackKey === 'artasset' ? deriveArtasset(entries) : deriveOps(entries);
  result.confirmedClaims = entries.length;
  return result;
}
