/**
 * AC-1 (partial, P1 scope): every forbidden write in the Plan §4 matrix
 * is rejected server-side — including admin writing a verdict.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, routeCardTo, talentApproveFixture } from './helpers/testApp.js';
import { Track } from '../src/models/Track.js';

let ctx;
let agents; // per-role supertest agents with live sessions

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    talentB: await ctx.loginAs(ctx.users.talentB),
    lead: await ctx.loginAs(ctx.users.lead),
    otherLead: await ctx.loginAs(ctx.users.otherLead),
    reviewer: await ctx.loginAs(ctx.users.reviewer),
    admin: await ctx.loginAs(ctx.users.admin),
  };
  // A1: nominations go to the track's exposure verifier for sign-off.
  await Track.updateOne({ key: 'ops' }, { exposureVerifierId: ctx.users.lead._id });
});

afterAll(() => ctx.teardown());

async function makeDraft(agent, subjectName = 'GCash') {
  const res = await agent.post('/api/cards').send({ subjectName, closeDate: '2026-06-30' });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('own card answers/edits — talent only', () => {
  it('talent edits their own draft', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.talentA
      .patch(`/api/cards/${card._id}`)
      .send({ rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'My answer' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.rawAnswers[0].answer).toBe('My answer');
  });

  it('another talent cannot edit it (and cannot even see it)', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.talentB.patch(`/api/cards/${card._id}`).send({ subjectName: 'hijack' });
    expect([403, 404]).toContain(res.status);
  });

  it('the lead cannot edit answers', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.lead.patch(`/api/cards/${card._id}`).send({ subjectName: 'lead-edit' });
    expect([403, 404]).toContain(res.status);
  });

  it('admin cannot edit answers', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.admin.patch(`/api/cards/${card._id}`).send({ subjectName: 'admin-edit' });
    expect([403, 404]).toContain(res.status);
  });
});

describe('card shells — RETIRED (Ruling C4)', () => {
  it('the shell endpoint is gone for everyone, lead included', async () => {
    for (const agent of [agents.lead, agents.talentA, agents.admin]) {
      const res = await agent.post('/api/team/shells').send({
        reportUserId: ctx.users.talentA._id.toString(),
        subjectName: 'Sun Life',
        closeDate: '2026-05-31',
      });
      expect(res.status).toBe(404);
    }
  });
});

describe('nominee tag — talent, own card only, after their approval (FR-13)', () => {
  async function approvedCard() {
    const card = await makeDraft(agents.talentA);
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    return card;
  }

  it('talent nominates on their own approved card', async () => {
    const card = await approvedCard();
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.reviewer._id.toString()],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('exposure-signoff'); // A1: no lead approval
  });

  it('two nominees are refused — exactly one per card (C2)', async () => {
    const card = await approvedCard();
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.reviewer._id.toString(), ctx.users.talentB._id.toString()],
    });
    expect(res.status).toBe(400);
  });

  it('nomination before approval is refused (Invariant 5: nothing routes early)', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.reviewer._id.toString()],
    });
    expect(res.status).toBe(409);
  });

  it('lead cannot nominate — no substitution surface (Invariant 4)', async () => {
    const card = await approvedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.lead._id.toString()],
    });
    expect([403, 404]).toContain(res.status);
  });

  it('admin cannot nominate either', async () => {
    const card = await approvedCard();
    const res = await agents.admin.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.reviewer._id.toString()],
    });
    expect([403, 404]).toContain(res.status);
  });

  it('advocate block: the talent\'s own lead is returned with a reason (FR-13a)', async () => {
    const card = await approvedCard();
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.lead._id.toString()],
    });
    expect(res.status).toBe(400);
    expect(res.body.failures[0].reason).toMatch(/advocate block/);
  });

  it('advocate block: a named call-maker on the card is returned with a reason', async () => {
    const card = await makeDraft(agents.talentA);
    await agents.talentA.patch(`/api/cards/${card._id}`).send({
      rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'Reviewer decided the schedule, I executed it.' }],
    });
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.reviewer._id.toString()],
    });
    expect(res.status).toBe(400);
    expect(res.body.failures[0].reason).toMatch(/named on the card/);
  });
});

describe('exposure sign-off — verifier setting only, never substitution (A1/C3)', () => {
  async function nominatedCard() {
    const card = await makeDraft(agents.talentA);
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeIds: [ctx.users.reviewer._id.toString()],
    });
    return card;
  }

  it('the verifier refuses WITH a reason — the pick returns to the talent (C3)', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({
      action: 'refuse',
      reason: 'They joined after this project closed',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.nomination.exposureSignoff.decision).toBe('refuse');
    expect(res.body.data.status).toBe('talent-approved'); // pick returned
  });

  it('refusing without a reason is refused', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({ action: 'refuse' });
    expect(res.status).toBe(400);
  });

  it('nobody but the named verifier can sign off — talent, other lead, ADMIN all rejected', async () => {
    const card = await nominatedCard();
    for (const agent of [agents.talentA, agents.otherLead, agents.admin, agents.reviewer]) {
      const res = await agent.post(`/api/cards/${card._id}/signoff`).send({
        action: 'confirm',
        note: 'x',
      });
      expect(res.status).toBe(403);
    }
  });

  it('sign-off has no substitution input: confirming routes to the TALENT\'S pick, only (Invariant 4)', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({
      action: 'confirm',
      note: 'They reviewed this account weekly — I saw the threads',
      approvedNomineeId: ctx.users.talentB._id.toString(), // ignored by construction
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('routed');
    expect(res.body.data.nomination.routedTo).toBe(ctx.users.reviewer._id.toString());
  });

  it('confirming needs the one-line note', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({ action: 'confirm' });
    expect(res.status).toBe(400);
  });
});

describe('verdict — Invariant 3: assigned non-advocate ONLY', () => {
  let routedCard;

  beforeAll(async () => {
    const draft = await makeDraft(agents.talentA, 'Verdict Subject');
    routedCard = await routeCardTo(draft._id, ctx.users.reviewer._id, ctx.users.talentA._id);
  });

  function verdictAttempt(agent) {
    const claimId = routedCard.claims[0]._id.toString();
    return agent
      .post(`/api/cards/${routedCard._id}/claims/${claimId}/verdict`)
      .send({ verdict: 'Confirmed', note: 'checked the weekly build records myself' }); // A5 attestation
  }

  it('the talent cannot write a verdict on their own card', async () => {
    expect((await verdictAttempt(agents.talentA)).status).toBe(403);
  });

  it('the lead cannot write a verdict', async () => {
    expect((await verdictAttempt(agents.lead)).status).toBe(403);
  });

  it('ADMIN cannot write a verdict — no exception for JP', async () => {
    expect((await verdictAttempt(agents.admin)).status).toBe(403);
  });

  it('an unassigned peer cannot write a verdict', async () => {
    expect((await verdictAttempt(agents.talentB)).status).toBe(403);
  });

  it('the assigned reviewer CAN write a verdict', async () => {
    const res = await verdictAttempt(agents.reviewer);
    expect(res.status).toBe(200);
    expect(res.body.data.claims[0].verdict).toBe('Confirmed');
    expect(res.body.data.status).toBe('confirmed'); // all claims decided, none Adjust
  });
});

describe('vocab pack publish — admin only', () => {
  const pack = { version: 'v0.2-test', packText: 'PACK TEXT', competencyOrDomainList: ['from-pack'] };

  it('talent cannot publish', async () => {
    expect((await agents.talentA.post('/api/admin/tracks/ops/pack').send(pack)).status).toBe(403);
  });

  it('lead cannot publish', async () => {
    expect((await agents.lead.post('/api/admin/tracks/ops/pack').send(pack)).status).toBe(403);
  });

  it('admin publishes; version is recorded', async () => {
    const res = await agents.admin.post('/api/admin/tracks/ops/pack').send(pack);
    expect(res.status).toBe(201);
    expect(res.body.data.vocabPackVersion).toBe('v0.2-test');
  });
});

describe('unauthenticated', () => {
  it('API rejects with 401', async () => {
    const res = await (await import('supertest')).default(ctx.app).get('/api/home');
    expect(res.status).toBe(401);
  });
});
