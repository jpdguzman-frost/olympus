/**
 * C2v2 (JP, Aug 6 — supersedes C2): the one-send document screen and
 * per-line checker fan-out.
 *
 *  - ONE send approves every ready line (Invariant 5 partial approval:
 *    the per-line record is still written); thin, undated, and unticked
 *    lines stay behind as costless drafts, invisible to every checker.
 *  - One pick covers the card; any line can switch to a different
 *    checker — exactly one non-advocate per line.
 *  - Each pick clears exposure on its own (per-pick sign-off rows);
 *    routes go live together once every pick has cleared.
 *  - The verdict guard is the LINE's checker: another checker, admin,
 *    anyone else — rejected identically (Invariant 3, per line).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, structureFixture } from './helpers/testApp.js';
import { Card } from '../src/models/Card.js';
import { Track } from '../src/models/Track.js';

let ctx;
let agents;

const THIN = 'insufficient detail — draft';

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    talentB: await ctx.loginAs(ctx.users.talentB),
    reviewer: await ctx.loginAs(ctx.users.reviewer),
    lead: await ctx.loginAs(ctx.users.lead),
    admin: await ctx.loginAs(ctx.users.admin),
  };
  await Track.updateOne({ key: 'ops' }, { exposureVerifierId: ctx.users.lead._id });
});

afterAll(() => ctx.teardown());

async function docCard(name, extraClaims = []) {
  const card = (await agents.talentA.post('/api/cards').send({ subjectName: name, closeDate: '2026-06-30' })).body.data;
  await agents.talentA.patch(`/api/cards/${card._id}`).send({
    rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'I ran the weekly builds myself.' }],
    sweepAnswers: [{ prompt: 'Sweep', answer: 'Not me.' }],
  });
  await structureFixture(card._id, ctx.users.talentA._id);
  const stored = await Card.findById(card._id);
  stored.claims.push(...extraClaims);
  await stored.save();
  return stored;
}

const CLEAN = (competency) => ({
  type: 'claim',
  competencyOrDomain: competency,
  sourceQuote: 'I ran the weekly builds myself.',
  anchorText: 'GCash, May 2026',
  anchorSource: 'structurer',
  flags: [],
});

describe('the one send (C2v2)', () => {
  it('approves ready lines, leaves thin/undated/unticked behind, and routes on sign-off', async () => {
    const card = await docCard('One Send', [
      CLEAN('second-line'),
      { ...CLEAN('thin-line'), flags: [THIN], missingPiece: 'a when — roughly when this was' },
      { ...CLEAN('no-date-line'), anchorText: null, anchorSource: null },
    ]);
    const [ready, unticked, thin, undated] = card.claims;

    const res = await agents.talentA.post(`/api/cards/${card._id}/send`).send({
      checkerId: ctx.users.reviewer._id.toString(),
      unticked: [unticked._id.toString()],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('exposure-signoff'); // no CAPS record → the human check

    const stored = await Card.findById(card._id);
    expect(stored.claims.id(ready._id).talentApproved).toBe(true); // the send IS the approval
    expect(stored.claims.id(ready._id).checkerId.toString()).toBe(ctx.users.reviewer._id.toString());
    for (const left of [unticked, thin, undated]) {
      expect(stored.claims.id(left._id).talentApproved).toBe(false); // costless drafts
      expect(stored.claims.id(left._id).checkerId).toBe(null);
    }

    // Per-pick sign-off row, then routed with the route clock running.
    const rows = (await agents.lead.get('/api/signoffs')).body.data.filter((r) => r._id === card._id.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toBe(1);
    const signed = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({
      action: 'confirm',
      note: 'Saw them in the weekly build threads',
      reviewerId: rows[0].reviewerId,
    });
    expect(signed.status).toBe(200);
    expect(signed.body.data.status).toBe('routed');
    expect(signed.body.data.nomination.routes[0].routedAt).toBeTruthy();

    // Drafts are invisible to the checker — they see only their ready line.
    const checkerView = await agents.reviewer.get(`/api/cards/${card._id}`);
    expect(checkerView.body.data.claims).toHaveLength(1);
    expect(checkerView.body.data.claims[0].competencyOrDomain).toBe('placeholder-from-pack');
  });

  it('sending with no pick, or with every line set aside, is refused in plain words', async () => {
    const noPick = await docCard('No Pick');
    const res = await agents.talentA.post(`/api/cards/${noPick._id}/send`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Pick who checks this/);

    const allThin = await docCard('All Thin');
    const stored = await Card.findById(allThin._id);
    for (const c of stored.claims) c.flags = [THIN];
    await stored.save();
    const res2 = await agents.talentA.post(`/api/cards/${allThin._id}/send`).send({
      checkerId: ctx.users.reviewer._id.toString(),
    });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/not backed yet|nothing to send/);
  });
});

describe('bolt-in thread dismiss (JP, Aug 6: toggle it off)', () => {
  it('an open add-on thread closes cleanly; said words stay on record', async () => {
    const card = await docCard('Dismiss Bolt-In');
    const stored = await Card.findById(card._id);
    stored.boltInThreads.push({
      competency: 'Team onboarding',
      thread: [
        { role: 'ai', text: 'What did you do?' },
        { role: 'talent', text: 'Actually never mind.' },
      ],
      status: 'open',
    });
    await stored.save();
    const threadId = stored.boltInThreads[0]._id.toString();

    const res = await agents.talentA.post(`/api/cards/${card._id}/bolt-in`).send({ threadId, dismiss: true });
    expect(res.status).toBe(200);
    const after = await Card.findById(card._id);
    expect(after.boltInThreads).toHaveLength(0); // toggled off, no residue
    expect(after.audit.some((a) => a.action === 'bolt-in-thread-dismissed')).toBe(true);
  });
});

describe('per-line checker fan-out (one non-advocate per line)', () => {
  let card;
  let lineA;
  let lineB;

  beforeAll(async () => {
    card = await docCard('Fan Out', [CLEAN('second-line')]);
    [lineA, lineB] = card.claims;

    const res = await agents.talentA.post(`/api/cards/${card._id}/send`).send({
      checkerId: ctx.users.reviewer._id.toString(),
      lineOverrides: { [lineB._id.toString()]: ctx.users.talentB._id.toString() },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.nomination.routes).toHaveLength(2);
  });

  it('each pick clears sign-off on its own; the card routes when the last one clears', async () => {
    const rows = (await agents.lead.get('/api/signoffs')).body.data.filter((r) => r._id === card._id.toString());
    expect(rows).toHaveLength(2); // one row PER PICK

    // With two picks waiting, the verifier must say which one.
    const vague = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({ action: 'confirm', note: 'x' });
    expect(vague.status).toBe(400);

    const first = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({
      action: 'confirm', note: 'Saw them on the build', reviewerId: ctx.users.reviewer._id.toString(),
    });
    expect(first.body.data.status).toBe('exposure-signoff'); // one pick still waiting

    const second = await agents.lead.post(`/api/cards/${card._id}/signoff`).send({
      action: 'confirm', note: 'They sat in the reviews', reviewerId: ctx.users.talentB._id.toString(),
    });
    expect(second.body.data.status).toBe('routed'); // every pick cleared → all routes live together
    expect(second.body.data.nomination.routes.every((r) => r.routedAt)).toBe(true);
  });

  it('a checker sees only THEIR lines', async () => {
    const viewA = await agents.reviewer.get(`/api/cards/${card._id}`);
    expect(viewA.body.data.claims).toHaveLength(1);
    expect(viewA.body.data.claims[0]._id).toBe(lineA._id.toString());

    const viewB = await agents.talentB.get(`/api/cards/${card._id}`);
    expect(viewB.body.data.claims).toHaveLength(1);
    expect(viewB.body.data.claims[0]._id).toBe(lineB._id.toString());
  });

  it('the verdict guard is the LINE\'s checker — the other checker and admin are rejected identically', async () => {
    const wrongChecker = await agents.reviewer
      .post(`/api/cards/${card._id}/claims/${lineB._id}/verdict`)
      .send({ verdict: 'Confirmed', note: 'x' });
    expect(wrongChecker.status).toBe(403);

    const adminTry = await agents.admin
      .post(`/api/cards/${card._id}/claims/${lineA._id}/verdict`)
      .send({ verdict: 'Confirmed', note: 'x' });
    expect(adminTry.status).toBe(403);
  });

  it('each checker decides their line; the card confirms when the last line is decided', async () => {
    const a = await agents.reviewer
      .post(`/api/cards/${card._id}/claims/${lineA._id}/verdict`)
      .send({ verdict: 'Confirmed', note: 'checked the build logs' });
    expect(a.status).toBe(200);
    expect(a.body.data.status).toBe('routed'); // lineB still undecided

    const b = await agents.talentB
      .post(`/api/cards/${card._id}/claims/${lineB._id}/verdict`)
      .send({ verdict: 'Confirmed', note: 'watched this happen weekly' });
    expect(b.status).toBe(200);
    expect(b.body.data.status).toBe('confirmed');
  });
});
