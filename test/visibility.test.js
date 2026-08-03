/**
 * AC-7: a talent's card is invisible to other talents; a non-advocate
 * sees only cards routed to them. Plus the lead read scope (confirmed
 * only) and admin read-all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, routeCardTo } from './helpers/testApp.js';
import { Card } from '../src/models/Card.js';
import { transition } from '../src/services/statusMachine.js';

let ctx;
let agents;
let draftA; // talentA's draft
let routedA; // talentA's routed card, assigned to reviewer
let confirmedA; // talentA's confirmed card

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    talentB: await ctx.loginAs(ctx.users.talentB),
    lead: await ctx.loginAs(ctx.users.lead),
    reviewer: await ctx.loginAs(ctx.users.reviewer),
    admin: await ctx.loginAs(ctx.users.admin),
  };

  draftA = (await agents.talentA.post('/api/cards').send({ subjectName: 'Draft Subject', closeDate: '2026-06-30' })).body.data;

  const toRoute = (await agents.talentA.post('/api/cards').send({ subjectName: 'Routed Subject', closeDate: '2026-06-30' })).body.data;
  routedA = await routeCardTo(toRoute._id, ctx.users.reviewer._id, ctx.users.talentA._id);

  const toConfirm = (await agents.talentA.post('/api/cards').send({ subjectName: 'Confirmed Subject', closeDate: '2026-03-31' })).body.data;
  const confirmed = await routeCardTo(toConfirm._id, ctx.users.reviewer._id, ctx.users.talentA._id);
  confirmed.claims[0].verdict = 'Confirmed';
  await transition(confirmed, 'confirmed', ctx.users.reviewer._id);
  await confirmed.save();
  confirmedA = confirmed;
});

afterAll(() => ctx.teardown());

describe('talent scope', () => {
  it('talent B cannot read talent A\'s card — 404, existence not leaked', async () => {
    expect((await agents.talentB.get(`/api/cards/${draftA._id}`)).status).toBe(404);
  });

  it('talent A sees only their own cards in the list', async () => {
    const res = await agents.talentA.get('/api/cards');
    const ids = res.body.data.map((c) => c.talentId);
    expect(new Set(ids)).toEqual(new Set([ctx.users.talentA._id.toString()]));
  });

  it('talent B\'s home contains none of talent A\'s cards', async () => {
    const res = await agents.talentB.get('/api/home');
    expect(res.body.data.drafts).toHaveLength(0);
    expect(res.body.data.confirmed).toHaveLength(0);
  });
});

describe('non-advocate scope', () => {
  it('reviewer\'s queue contains ONLY cards routed to them', async () => {
    const res = await agents.reviewer.get('/api/queue');
    const ids = res.body.data.map((c) => c._id);
    expect(ids).toContain(routedA._id.toString());
    expect(ids).not.toContain(draftA._id);
  });

  it('reviewer can read the routed card', async () => {
    expect((await agents.reviewer.get(`/api/cards/${routedA._id}`)).status).toBe(200);
  });

  it('reviewer cannot read a card NOT routed to them', async () => {
    expect((await agents.reviewer.get(`/api/cards/${draftA._id}`)).status).toBe(404);
  });
});

describe('lead scope — reports\' confirmed cards only', () => {
  it('lead reads the confirmed card', async () => {
    expect((await agents.lead.get(`/api/cards/${confirmedA._id}`)).status).toBe(200);
  });

  it('lead cannot read the draft', async () => {
    expect((await agents.lead.get(`/api/cards/${draftA._id}`)).status).toBe(404);
  });

  it('team list contains confirmed only', async () => {
    const res = await agents.lead.get('/api/team/cards');
    expect(res.status).toBe(200);
    const statuses = new Set(res.body.data.map((c) => c.status));
    expect(statuses).toEqual(new Set(['confirmed']));
  });
});

describe('admin scope', () => {
  it('admin reads any card', async () => {
    expect((await agents.admin.get(`/api/cards/${draftA._id}`)).status).toBe(200);
  });

  it('aggregate view counts cards and statuses only — no ranking surface exists', async () => {
    const res = await agents.admin.get('/api/admin/cards');
    expect(res.status).toBe(200);
    // Invariant 12 guard: the payload carries no score/rank/rating fields.
    for (const card of res.body.data) {
      expect(card).not.toHaveProperty('score');
      expect(card).not.toHaveProperty('rank');
      expect(card).not.toHaveProperty('rating');
    }
  });
});
