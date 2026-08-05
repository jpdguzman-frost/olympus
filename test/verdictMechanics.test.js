/**
 * B2 (Amendment 1 §A5 + Ruling C1): attestation, the deadlock machine,
 * SLA chases/escalation, and the packaging-deferred hook.
 *
 * The load-bearing assertions:
 *  - Confirmed without an attestation is refused; the attestation is
 *    stored and audited.
 *  - Verdict sovereignty survives every new state: JP writes rulings,
 *    never verdicts — the verdict field rejects admin in 'deadlocked'
 *    and 'ruled' exactly as in 'routed'.
 *  - Deadlock fires ONLY when the reviewer holds Adjust on a claim the
 *    talent defended; both final positions land in the audit trail.
 *  - Refusal after ruling reassigns to the OD-2 fallback setting, read
 *    at escalation time, with the exclusion rule; unset/excluded HALTS
 *    visibly instead of guessing.
 *  - The SLA never writes a verdict: two chases, then reassignment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, routeCardTo } from './helpers/testApp.js';
import { Card } from '../src/models/Card.js';
import { Track } from '../src/models/Track.js';
import { runSlaPass } from '../src/workers/slaWorker.js';
import { workingDaysBefore } from '../src/utils/workingDays.js';

let ctx;
let agents;

const ATTEST = { verdict: 'Confirmed', note: 'checked the board history myself' };

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    talentB: await ctx.loginAs(ctx.users.talentB),
    reviewer: await ctx.loginAs(ctx.users.reviewer),
    admin: await ctx.loginAs(ctx.users.admin),
  };
});

afterAll(() => ctx.teardown());

async function routedCard(name) {
  const card = (await agents.talentA.post('/api/cards').send({ subjectName: name, closeDate: '2026-06-30' })).body.data;
  return routeCardTo(card._id, ctx.users.reviewer._id, ctx.users.talentA._id);
}

/** Drive a routed card into 'deadlocked': Adjust → defend → re-route → Adjust again. */
async function deadlockedCard(name) {
  const card = await routedCard(name);
  const claimId = card.claims[0]._id.toString();
  await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
    .send({ verdict: 'Adjust', note: 'the PM still checks this' });
  await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`)
    .send({ action: 'defend', statement: 'Nobody has checked behind me since March — the board history shows it' });
  await agents.talentA.post(`/api/cards/${card._id}/reroute`);
  const res = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
    .send({ verdict: 'Adjust', note: 'I watched the PM re-check it in June' });
  expect(res.body.data.status).toBe('deadlocked');
  return Card.findById(card._id);
}

describe('A5 attestation', () => {
  it('Confirmed without a note is refused; with one it lands and the card confirms', async () => {
    const card = await routedCard('Attestation Card');
    const claimId = card.claims[0]._id.toString();

    const bare = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send({ verdict: 'Confirmed' });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/attestation/i);

    const ok = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send(ATTEST);
    expect(ok.status).toBe(200);
    expect(ok.body.data.claims[0].verdictNote).toBe(ATTEST.note);
    expect(ok.body.data.status).toBe('confirmed');
  });
});

describe('C1 deadlock machine', () => {
  it('defence requires a statement; holding Adjust on a defended claim deadlocks with both positions logged', async () => {
    const card = await routedCard('Deadlock Card');
    const claimId = card.claims[0]._id.toString();
    await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Adjust', note: 'someone still checks this' });

    const bare = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'defend' });
    expect(bare.status).toBe(400);

    const defended = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`)
      .send({ action: 'defend', statement: 'It stands: I have run it unchecked since March' });
    expect(defended.status).toBe(200);
    expect(defended.body.data.claims[0].talentApproved).toBe(true);

    await agents.talentA.post(`/api/cards/${card._id}/reroute`);
    const held = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Adjust', note: 'I saw the PM check it in June' });
    expect(held.body.data.status).toBe('deadlocked');

    const stored = await Card.findById(card._id);
    const entry = stored.audit.find((a) => a.action === 'deadlocked');
    expect(entry.after.positions[0].talentFinalPosition).toMatch(/since March/);
    expect(entry.after.positions[0].reviewerFinalPosition).toMatch(/June/);
  });

  it('an Adjust on an UNdefended claim never deadlocks — the normal adjust leg runs', async () => {
    const card = await routedCard('Normal Adjust Card');
    const claimId = card.claims[0]._id.toString();
    const res = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Adjust', note: 'dates are off' });
    expect(res.body.data.status).toBe('adjust');
  });

  it('conceding a defended claim requires a stated reason', async () => {
    const card = await routedCard('Concession Card');
    const claimId = card.claims[0]._id.toString();
    await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Adjust', note: 'overclaimed' });
    await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`)
      .send({ action: 'defend', statement: 'it stands' });

    const bare = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`)
      .send({ action: 'fix', labels: {} });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/defended/i);
  });

  it('JP rules — guidance, never a verdict; the reviewer then writes the verdict themselves', async () => {
    const card = await deadlockedCard('Ruling Card');
    const claimId = card.claims[0]._id.toString();

    expect((await agents.talentA.post(`/api/admin/cards/${card._id}/ruling`).send({ text: 'x' })).status).toBe(403);

    // Sovereignty holds in deadlocked: admin cannot write the verdict.
    expect(
      (await agents.admin.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send(ATTEST)).status,
    ).toBe(403);

    const ruled = await agents.admin.post(`/api/admin/cards/${card._id}/ruling`)
      .send({ text: 'The board history is the evidence — June was a one-off spot check, not a standing check.' });
    expect(ruled.status).toBe(200);
    expect(ruled.body.data.status).toBe('ruled');

    // ...and in ruled.
    expect(
      (await agents.admin.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send(ATTEST)).status,
    ).toBe(403);

    const confirmed = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Confirmed', note: 'agree per the ruling — board history checked' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('confirmed');
  });

  it('refusal after ruling reassigns to the fallback, who reviews fresh and writes the verdict', async () => {
    const card = await deadlockedCard('Refusal Card');
    const claimId = card.claims[0]._id.toString();
    await agents.admin.post(`/api/admin/cards/${card._id}/ruling`).send({ text: 'ruling text' });
    await agents.admin.patch('/api/admin/tracks/ops/settings')
      .send({ fallbackReviewerId: String(ctx.users.talentB._id) });

    expect((await agents.reviewer.post(`/api/cards/${card._id}/refuse-ruling`).send({})).status).toBe(400);

    const refused = await agents.reviewer.post(`/api/cards/${card._id}/refuse-ruling`)
      .send({ statement: 'My final position stands: I watched the check happen' });
    expect(refused.status).toBe(200);
    expect(refused.body.data.status).toBe('reassigned');
    expect(String(refused.body.data.nomination.routedTo)).toBe(String(ctx.users.talentB._id));
    expect(refused.body.data.claims[0].verdict).toBe(null); // fallback reviews fresh

    // The refusing reviewer is no longer the assignee — sovereignty follows assignment.
    expect(
      (await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send(ATTEST)).status,
    ).toBe(403);

    const final = await agents.talentB.post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Confirmed', note: 'checked the board history — it held unchecked' });
    expect(final.status).toBe(200);
    expect(final.body.data.status).toBe('confirmed');
  });

  it('an excluded fallback HALTS the escalation visibly instead of guessing', async () => {
    const card = await deadlockedCard('Halted Card');
    await agents.admin.post(`/api/admin/cards/${card._id}/ruling`).send({ text: 'ruling text' });
    // The assigned reviewer is a party to the deadlock — excluded.
    await agents.admin.patch('/api/admin/tracks/ops/settings')
      .send({ fallbackReviewerId: String(ctx.users.reviewer._id) });

    const refused = await agents.reviewer.post(`/api/cards/${card._id}/refuse-ruling`)
      .send({ statement: 'still no' });
    expect(refused.status).toBe(200);
    expect(refused.body.data.status).toBe('ruled'); // nothing moved
    expect(refused.body.data.nomination.escalationHalted.reason).toMatch(/party to this deadlock/);

    await agents.admin.patch('/api/admin/tracks/ops/settings').send({ fallbackReviewerId: null });
  });
});

describe('A5 SLA worker', () => {
  it('two chases then escalation; non-response is never a verdict', async () => {
    const card = await routedCard('SLA Card');
    const now = new Date();
    await Card.updateOne(
      { _id: card._id },
      { 'nomination.routedAt': workingDaysBefore(now, 11) },
    );

    expect((await runSlaPass({ now })).find((o) => String(o.cardId) === String(card._id)).outcome).toBe('chase-1');
    expect((await runSlaPass({ now })).find((o) => String(o.cardId) === String(card._id)).outcome).toBe('chase-2');

    // Third pass escalates — but no fallback is set → visible halt, no guessing.
    await runSlaPass({ now });
    let stored = await Card.findById(card._id);
    expect(stored.status).toBe('routed');
    expect(stored.nomination.escalationHalted.reason).toMatch(/OD-2/);
    expect(stored.claims[0].verdict).toBe(null); // never a verdict

    // JP fixes the setting; the halt clears manually and the next pass reassigns.
    await agents.admin.patch('/api/admin/tracks/ops/settings')
      .send({ fallbackReviewerId: String(ctx.users.talentB._id) });
    await Card.updateOne({ _id: card._id }, { 'nomination.escalationHalted': null });
    await runSlaPass({ now });
    stored = await Card.findById(card._id);
    expect(stored.status).toBe('reassigned');
    expect(String(stored.nomination.routedTo)).toBe(String(ctx.users.talentB._id));
    expect(stored.nomination.escalated).toBe('sla');
    expect(stored.claims[0].verdict).toBe(null);

    await agents.admin.patch('/api/admin/tracks/ops/settings').send({ fallbackReviewerId: null });
  });

  it('a fresh routing gets no chase', async () => {
    const card = await routedCard('Fresh Card');
    const outcomes = await runSlaPass({ now: new Date() });
    expect(outcomes.find((o) => String(o.cardId) === String(card._id))).toBeUndefined();
  });
});

describe('JP dashboard + nudge + packaging hook', () => {
  it('pending-verdicts lists routed cards with aging and chases; admin only', async () => {
    await routedCard('Dashboard Card');
    expect((await agents.talentA.get('/api/admin/pending-verdicts')).status).toBe(403);
    const res = await agents.admin.get('/api/admin/pending-verdicts');
    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.subject.name === 'Dashboard Card');
    expect(row.reviewerName).toBe('Reviewer');
    expect(typeof row.agingWorkingDays).toBe('number');
  });

  it('manual nudge records a chase', async () => {
    const card = await routedCard('Nudge Card');
    const res = await agents.admin.post(`/api/admin/cards/${card._id}/nudge`);
    expect(res.status).toBe(200);
    expect(res.body.data.nomination.chases[0].kind).toBe('manual-nudge');
  });

  it('packaging deferral marks a confirmed card; the status and level stay', async () => {
    const card = await routedCard('Defer Card');
    const claimId = card.claims[0]._id.toString();
    await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send(ATTEST);

    expect((await agents.talentA.post(`/api/admin/cards/${card._id}/defer-packaging`)).status).toBe(403);
    const res = await agents.admin.post(`/api/admin/cards/${card._id}/defer-packaging`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed'); // never erased
    expect(res.body.data.packagingDeferredAt).not.toBe(null);
    expect(res.body.data.claims[0].verdict).toBe('Confirmed');
  });
});
