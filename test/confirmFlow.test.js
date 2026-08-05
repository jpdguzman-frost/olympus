/**
 * P4: the confirm → nominate → route → verdict → adjust → revise cycle
 * (FR-12..FR-17), plus BR-4 STALE and the FR-17 repeat-reviewer prompt.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, structureFixture, talentApproveFixture, routeCardTo } from './helpers/testApp.js';
import { Card } from '../src/models/Card.js';
import { Track } from '../src/models/Track.js';
import { User } from '../src/models/User.js';
import { repeatStreakFor } from '../src/services/confirmService.js';

let ctx;
let agents;

const VOCAB = {
  competencyOrDomainList: ['placeholder-from-pack', 'build-ops'],
  controlledVocabulary: { execution: ['I run it', 'Someone checks behind me'] },
};

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    lead: await ctx.loginAs(ctx.users.lead),
    reviewer: await ctx.loginAs(ctx.users.reviewer),
    admin: await ctx.loginAs(ctx.users.admin),
  };
  await Track.updateOne(
    { key: 'ops' },
    {
      packText: 'TEST PACK',
      vocabPackVersion: 'v-test',
      competencyOrDomainList: VOCAB.competencyOrDomainList,
      controlledVocabulary: VOCAB.controlledVocabulary,
      calibrationMode: false,
    },
  );
});

afterAll(() => ctx.teardown());

async function draft(subjectName, answer = 'I ran the weekly builds myself.') {
  const card = (await agents.talentA.post('/api/cards').send({ subjectName, closeDate: '2026-06-30' })).body.data;
  await agents.talentA.patch(`/api/cards/${card._id}`).send({
    rawAnswers: [{ questionIndex: 0, question: 'Q1', answer }],
    sweepAnswers: [{ prompt: 'Sweep', answer: 'Not me.' }],
  });
  return card;
}

describe('confirm screen (FR-12)', () => {
  it('talent approves a claim line', async () => {
    const card = await draft('Approve Line');
    await structureFixture(card._id, ctx.users.talentA._id);
    const stored = await Card.findById(card._id);
    const claimId = stored.claims[0]._id.toString();

    const res = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.data.claims[0].talentApproved).toBe(true);
  });

  it('a fix re-runs the validation layer — off-vocabulary is rejected (Invariant 6)', async () => {
    const card = await draft('Fix Line');
    await structureFixture(card._id, ctx.users.talentA._id);
    const stored = await Card.findById(card._id);
    const claimId = stored.claims[0]._id.toString();

    const bad = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'fix',
      labels: { execution: 'Level 5 wizard' },
    });
    expect(bad.status).toBe(400);

    const good = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'fix',
      labels: { execution: 'I run it' },
    });
    expect(good.status).toBe(200);
    expect(good.body.data.claims[0].labels.execution).toBe('I run it');
    expect(good.body.data.claims[0].talentApproved).toBe(true);
  });

  it('full approval requires every claim decided (Invariant 5)', async () => {
    const card = await draft('Full Approval');
    await structureFixture(card._id, ctx.users.talentA._id);

    expect((await agents.talentA.post(`/api/cards/${card._id}/approve`)).status).toBe(409);

    const stored = await Card.findById(card._id);
    const claimId = stored.claims[0]._id.toString();
    await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });

    const res = await agents.talentA.post(`/api/cards/${card._id}/approve`).send({ honestGap: 'Cross-track calls.' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('talent-approved');
    expect(res.body.data.honestGap).toBe('Cross-track calls.');
  });

  it('nobody but the talent can approve/fix claims', async () => {
    const card = await draft('Not Yours');
    await structureFixture(card._id, ctx.users.talentA._id);
    const stored = await Card.findById(card._id);
    const claimId = stored.claims[0]._id.toString();
    for (const agent of [agents.lead, agents.admin, agents.reviewer]) {
      const res = await agent.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });
      expect([403, 404]).toContain(res.status);
    }
  });
});

describe('verdict → adjust → revise → re-route (FR-16, BR-7)', () => {
  it('the full cycle works and Adjust verdicts clear on re-route', async () => {
    const card = await draft('Adjust Cycle');
    const routed = await routeCardTo(card._id, ctx.users.reviewer._id, ctx.users.talentA._id);
    const claimId = routed.claims[0]._id.toString();

    // Reviewer adjusts with a required note
    const noNote = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send({ verdict: 'Adjust' });
    expect(noNote.status).toBe(400);
    const adjusted = await agents.reviewer.post(`/api/cards/${card._id}/claims/${claimId}/verdict`).send({
      verdict: 'Adjust',
      note: 'The quote reads execution, not decision.',
    });
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.data.status).toBe('adjust'); // all claims decided, one Adjust

    // Talent cannot re-route before fixing
    expect((await agents.talentA.post(`/api/cards/${card._id}/reroute`)).status).toBe(409);

    // Talent fixes the claim, then sends it back
    await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });
    const rerouted = await agents.talentA.post(`/api/cards/${card._id}/reroute`);
    expect(rerouted.status).toBe(200);
    expect(rerouted.body.data.status).toBe('routed');
    expect(rerouted.body.data.claims[0].verdict).toBe(null); // Adjust cleared for re-review
    expect(rerouted.body.data.nomination.routedTo).toBe(ctx.users.reviewer._id.toString()); // same reviewer

    // Reviewer confirms this time → card confirms
    const confirmed = await agents.reviewer
      .post(`/api/cards/${card._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Confirmed', note: 'verified against the revised labels' }); // A5 attestation
    expect(confirmed.body.data.status).toBe('confirmed');
  });
});

describe('repeat-reviewer streak (FR-17) and thin pool (FR-15)', () => {
  it('three consecutive same-reviewer routings read as a streak of 3', async () => {
    for (const name of ['Streak 1', 'Streak 2', 'Streak 3']) {
      const card = await draft(name);
      await routeCardTo(card._id, ctx.users.reviewer._id, ctx.users.talentA._id);
    }
    const streak = await repeatStreakFor(ctx.users.talentA._id, ctx.users.reviewer._id);
    expect(streak).toBeGreaterThanOrEqual(3);
  });

  it('thin pool without a configured fallback reviewer is refused with the OD-2 message', async () => {
    const card = await draft('Thin Pool No Config');
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({ thinPool: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ask JP/);
  });

  it('thin pool routes to the configured fallback, visibly marked', async () => {
    await Track.updateOne({ key: 'ops' }, { fallbackReviewerId: ctx.users.reviewer._id });
    const card = await draft('Thin Pool Configured');
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({ thinPool: true });
    expect(res.status).toBe(200);
    expect(res.body.data.nomination.thinPool).toBe(true);
    expect(res.body.data.nomination.nominees[0].role).toBe('fallback reviewer');
    await Track.updateOne({ key: 'ops' }, { fallbackReviewerId: null }); // back to OD-2-unset
  });
});

describe('STALE context (BR-4)', () => {
  it('a card filed 60+ days after close presents stale — context, never a block', async () => {
    const card = await draft('Old Close');
    await Card.updateOne(
      { _id: card._id },
      { closeDate: new Date('2026-01-15'), filedDate: new Date('2026-06-30') },
    );
    const res = await agents.talentA.get(`/api/cards/${card._id}`);
    expect(res.body.data.stale).toBe(true);

    const fresh = await agents.talentA.get('/api/cards');
    const found = fresh.body.data.find((c) => c._id === card._id);
    expect(found.stale).toBe(true);
  });
});

describe('lead nominee queue (FR-14/FR-17 surface)', () => {
  it('shows waiting cards with nominees, checks, and streaks — lead only', async () => {
    const card = await draft('Queue Card');
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.talentB._id.toString()],
    });

    const res = await agents.lead.get('/api/team/nominee-queue');
    expect(res.status).toBe(200);
    const found = res.body.data.find((c) => c._id === card._id);
    expect(found).toBeTruthy();
    expect(found.talentName).toBe('Talent A');
    expect(found.repeatStreaks).toBeTruthy();

    expect((await agents.talentA.get('/api/team/nominee-queue')).status).toBe(403);
  });
});
