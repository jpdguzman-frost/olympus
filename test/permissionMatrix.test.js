/**
 * AC-1 (partial, P1 scope): every forbidden write in the Plan §4 matrix
 * is rejected server-side — including admin writing a verdict.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, routeCardTo } from './helpers/testApp.js';

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

describe('card shell — lead only, own reports only, name+date only', () => {
  it('lead opens a shell for their report', async () => {
    const res = await agents.lead.post('/api/team/shells').send({
      reportUserId: ctx.users.talentA._id.toString(),
      subjectName: 'Sun Life',
      closeDate: '2026-05-31',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.rawAnswers).toHaveLength(0); // no content — FR-5
  });

  it('talent cannot open a shell', async () => {
    const res = await agents.talentA.post('/api/team/shells').send({
      reportUserId: ctx.users.talentB._id.toString(),
      subjectName: 'X',
      closeDate: '2026-05-31',
    });
    expect(res.status).toBe(403);
  });

  it('a lead cannot shell someone else\'s report', async () => {
    const res = await agents.otherLead.post('/api/team/shells').send({
      reportUserId: ctx.users.talentA._id.toString(),
      subjectName: 'X',
      closeDate: '2026-05-31',
    });
    expect(res.status).toBe(403);
  });
});

describe('nominee tag — talent, own card only', () => {
  it('talent nominates on their own card', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominees`).send({
      nominees: [{ userId: ctx.users.reviewer._id.toString(), name: 'Reviewer', role: 'peer' }],
    });
    expect(res.status).toBe(200);
  });

  it('lead cannot set nominees — no substitution surface (Invariant 4)', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.lead.post(`/api/cards/${card._id}/nominees`).send({
      nominees: [{ userId: ctx.users.lead._id.toString(), name: 'Lead pick', role: 'peer' }],
    });
    expect([403, 404]).toContain(res.status);
  });

  it('admin cannot set nominees either', async () => {
    const card = await makeDraft(agents.talentA);
    const res = await agents.admin.post(`/api/cards/${card._id}/nominees`).send({
      nominees: [{ userId: ctx.users.reviewer._id.toString(), name: 'R', role: 'peer' }],
    });
    expect([403, 404]).toContain(res.status);
  });
});

describe('nominee approve/reject — lead only, reason required on reject', () => {
  async function nominatedCard() {
    const card = await makeDraft(agents.talentA);
    await agents.talentA.post(`/api/cards/${card._id}/nominees`).send({
      nominees: [{ userId: ctx.users.reviewer._id.toString(), name: 'Reviewer', role: 'peer' }],
    });
    return card;
  }

  it('lead rejects WITH a reason — returns pick to talent', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/nominee-decision`).send({
      action: 'reject',
      reason: 'Named call-maker on this card',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.nomination.leadDecision.action).toBe('reject');
  });

  it('lead cannot reject without a reason', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/nominee-decision`).send({ action: 'reject' });
    expect(res.status).toBe(400);
  });

  it('talent cannot decide on nominees', async () => {
    const card = await nominatedCard();
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominee-decision`).send({ action: 'approve' });
    expect(res.status).toBe(403);
  });

  it('there is no substitution parameter — a lead-sent nominee list is ignored by the decision route', async () => {
    const card = await nominatedCard();
    const res = await agents.lead.post(`/api/cards/${card._id}/nominee-decision`).send({
      action: 'approve',
      nominees: [{ userId: ctx.users.lead._id.toString(), name: 'Substituted', role: 'peer' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.nomination.nominees[0].name).toBe('Reviewer'); // untouched
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
      .send({ verdict: 'Confirmed' });
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
