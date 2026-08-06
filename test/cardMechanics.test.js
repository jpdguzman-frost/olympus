/**
 * B4 (Amendment 1 §A4): date anchoring, the contention loop, signals
 * noted, and the draft lifecycle.
 *
 * Load-bearing assertions:
 *  - No claim is approvable without account + date/period; the line
 *    stays draft ("needs a date"), never blocked, never blamed.
 *  - A contested mapping is NEVER final over the talent's objection:
 *    re-map or explain, and the answer always returns to the talent
 *    unapproved. Re-maps face the FR-10 wall — they cannot inflate.
 *  - Signals noted carry verbatim quotes or they drop; they are
 *    stripped during calibration hold like claims.
 *  - Drafts archive (never delete) at 90 idle days with one nudge;
 *    only draft-archives revive; raw answers survive untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, structureFixture } from './helpers/testApp.js';
import { Card } from '../src/models/Card.js';
import { Track } from '../src/models/Track.js';
import { validateStructuredOutput } from '../src/services/structurerService.js';
import { runContentionPass } from '../src/workers/structurerWorker.js';
import { runLifecyclePass } from '../src/workers/lifecycleWorker.js';
import { transition } from '../src/services/statusMachine.js';

let ctx;
let agents;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    admin: await ctx.loginAs(ctx.users.admin),
    reviewer: await ctx.loginAs(ctx.users.reviewer),
  };
  await Track.updateOne(
    { key: 'ops' },
    {
      packText: 'TEST PACK',
      vocabPackVersion: 'v-test',
      competencyOrDomainList: ['placeholder-from-pack', 'build-ops'],
      controlledVocabulary: { execution: ['I run it'] },
      calibrationMode: false,
    },
  );
});

afterAll(() => ctx.teardown());

async function structuredCard(name) {
  const card = (await agents.talentA.post('/api/cards').send({ subjectName: name, closeDate: '2026-06-30' })).body.data;
  await agents.talentA.patch(`/api/cards/${card._id}`).send({
    rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'I run it daily on GCash since April.' }],
    sweepAnswers: [{ prompt: 'Sweep', answer: 'Not me.' }],
  });
  await structureFixture(card._id, ctx.users.talentA._id);
  return Card.findById(card._id);
}

function fakeRemapClient(result) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }),
    },
  };
}

describe('A4 date anchoring', () => {
  it('an unanchored line cannot be approved — it needs a date first, in the talent\'s words', async () => {
    const card = await structuredCard('Anchor Card');
    const claim = card.claims[0];
    claim.anchorText = null;
    claim.anchorSource = null;
    await card.save();
    const claimId = claim._id.toString();

    const blocked = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/needs a date/);

    const anchored = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'anchor',
      statement: 'GCash, April to June 2026',
    });
    expect(anchored.status).toBe(200);
    expect(anchored.body.data.claims[0].anchorText).toBe('GCash, April to June 2026');
    expect(anchored.body.data.claims[0].anchorSource).toBe('talent');

    const ok = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.claims[0].talentApproved).toBe(true);
  });

  it('the structurer output carries the anchor from the talent\'s words; a fix keeps it', async () => {
    const track = await Track.findOne({ key: 'ops' });
    const cardStub = {
      rawAnswers: [{ answer: 'I run it daily on GCash since April.' }],
      sweepAnswers: [],
    };
    const { claims } = validateStructuredOutput(track, cardStub, {
      claims: [{
        type: 'claim',
        competencyOrDomain: 'build-ops',
        labels: { execution: 'I run it' },
        sourceQuote: 'I run it daily',
        flags: [],
        anchor: 'GCash, since April',
      }],
      followUps: [],
      signalsNoted: [],
    });
    expect(claims[0].anchorText).toBe('GCash, since April');
    expect(claims[0].anchorSource).toBe('structurer');
  });
});

describe('A4 contention loop — never final over the talent\'s objection', () => {
  it('contest → re-map: labels change within the vocabulary and the line returns unapproved', async () => {
    const card = await structuredCard('Contest Remap');
    const claimId = card.claims[0]._id.toString();

    const contested = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'contest',
      statement: 'I said I run it MYSELF — nobody checks behind me',
    });
    expect(contested.status).toBe(200);

    const outcomes = await runContentionPass({
      client: fakeRemapClient({
        remapped: true,
        claim: {
          type: 'claim',
          competencyOrDomain: 'build-ops',
          labels: { execution: 'I run it' },
          sourceQuote: 'I run it daily on GCash since April.',
          flags: [],
          anchor: 'GCash, since April',
        },
        explanation: 'Re-read: the words support ownership.',
      }),
    });
    expect(outcomes[0].outcome).toBe('remapped');

    const stored = await Card.findById(card._id);
    expect(stored.claims[0].labels.execution).toBe('I run it');
    expect(stored.claims[0].talentApproved).toBe(false); // always back to the talent
    expect(stored.claims[0].contentions[0].outcome).toBe('remapped');
  });

  it('contest → explain: the mapping stands with a plain-words answer; the talent is never forced to accept', async () => {
    const card = await structuredCard('Contest Explain');
    const claimId = card.claims[0]._id.toString();
    await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'contest',
      statement: 'this should read higher',
    });

    await runContentionPass({
      client: fakeRemapClient({ remapped: false, claim: {
        type: 'x', competencyOrDomain: 'build-ops', labels: {}, sourceQuote: 'x', flags: [], anchor: '',
      }, explanation: 'Your words say the PM checks weekly — the label follows your words.' }),
    });

    const stored = await Card.findById(card._id);
    expect(stored.claims[0].contentions[0].outcome).toBe('explained');
    expect(stored.claims[0].contentions[0].response).toMatch(/your words/i);
    // The talent can still fix or remove — nothing forces acceptance.
    const removed = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'fix', remove: true });
    expect(removed.status).toBe(200);
  });

  it('a re-map that fabricates a quote falls to the FR-10 wall and becomes an explanation', async () => {
    const card = await structuredCard('Contest Inflate');
    const claimId = card.claims[0]._id.toString();
    await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'contest',
      statement: 'raise it',
    });

    await runContentionPass({
      client: fakeRemapClient({
        remapped: true,
        claim: {
          type: 'claim',
          competencyOrDomain: 'build-ops',
          labels: { execution: 'I run it' },
          sourceQuote: 'I single-handedly ran the entire operation',
          flags: [],
          anchor: '',
        },
        explanation: 'raised',
      }),
    });

    const stored = await Card.findById(card._id);
    const contention = stored.claims[0].contentions[0];
    expect(contention.outcome).toBe('explained');
    expect(contention.response).toMatch(/could not stand/);
    expect(stored.claims[0].sourceQuote).toBe('I ran the weekly builds myself.'); // untouched
  });

  it('only one open contention per line at a time', async () => {
    const card = await structuredCard('Contest Twice');
    const claimId = card.claims[0]._id.toString();
    await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'contest', statement: 'a' });
    const second = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'contest', statement: 'b' });
    expect(second.status).toBe(409);
  });
});

describe("JP's thin-line rule (Aug 6): insufficient detail cannot count as-is", () => {
  async function thinCard(name) {
    const card = await structuredCard(name);
    const stored = await Card.findById(card._id);
    stored.claims[0].flags = ['insufficient detail — draft'];
    await stored.save();
    return stored;
  }

  it('a thin line cannot be approved, defended, or kept via fix — plain message, no penalty', async () => {
    const card = await thinCard('Thin Line Card');
    const claimId = card.claims[0]._id.toString();
    const res = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({ action: 'approve' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too thin to count/);
  });

  it('add-detail saves the words verbatim and sends the line for a re-check', async () => {
    const card = await thinCard('Thin Detail Card');
    const claimId = card.claims[0]._id.toString();
    const res = await agents.talentA.post(`/api/cards/${card._id}/claims/${claimId}/decide`).send({
      action: 'add-detail',
      statement: 'This was on GCash, March to June 2026 — the board history shows it.',
    });
    expect(res.status).toBe(200);
    const stored = await Card.findById(card._id);
    expect(stored.rawAnswers.some((a) => a.answer.includes('March to June 2026'))).toBe(true); // quotable now
    expect(stored.claims[0].contentions.some((c) => c.outcome === null)).toBe(true); // re-check queued
  });

  it('thin drafts never block the card: it routes with only the approved lines, and the reviewer never sees the draft', async () => {
    const card = await structuredCard('Partial Route Card');
    const stored = await Card.findById(card._id);
    stored.claims.push({
      type: 'claim', competencyOrDomain: 'build-ops', labels: {}, sourceQuote: 'I run it daily on GCash since April.',
      anchorText: null, flags: ['insufficient detail — draft'],
    });
    stored.claims[0].talentApproved = true;
    await stored.save();

    const approved = await agents.talentA.post(`/api/cards/${card._id}/approve`);
    expect(approved.status).toBe(200); // the thin draft did not block

    // Route it and check reviewer visibility + verdict wall.
    const { transition } = await import('../src/services/statusMachine.js');
    const routed = await Card.findById(card._id);
    routed.nomination.nominees = [{ userId: ctx.users.reviewer._id, name: 'R', role: 'confirmer' }];
    await transition(routed, 'exposure-signoff', ctx.users.talentA._id);
    await transition(routed, 'routed', ctx.users.talentA._id);
    routed.nomination.routedTo = ctx.users.reviewer._id;
    routed.nomination.routedAt = new Date();
    await routed.save();

    const reviewerAgent = await ctx.loginAs(ctx.users.reviewer);
    const view = await reviewerAgent.get(`/api/cards/${card._id}`);
    expect(view.body.data.claims).toHaveLength(1); // the draft is invisible (Invariant 5)

    const thinId = routed.claims[1]._id.toString();
    const verdictOnDraft = await reviewerAgent.post(`/api/cards/${card._id}/claims/${thinId}/verdict`)
      .send({ verdict: 'Confirmed', note: 'x' });
    expect(verdictOnDraft.status).toBe(409); // drafts take no verdict

    const goodId = routed.claims[0]._id.toString();
    const confirmed = await reviewerAgent.post(`/api/cards/${card._id}/claims/${goodId}/verdict`)
      .send({ verdict: 'Confirmed', note: 'checked the board history' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('confirmed'); // the leftover draft did not block confirmation
  });
});

describe('A4 signals noted, not claimed', () => {
  it('a signal with a verbatim quote lands; a fabricated one drops', async () => {
    const track = await Track.findOne({ key: 'ops' });
    const cardStub = {
      rawAnswers: [{ answer: 'I also ran the weekly leads sync when Miles was out.' }],
      sweepAnswers: [],
    };
    const { signalsNoted, rejected } = validateStructuredOutput(track, cardStub, {
      claims: [],
      followUps: [],
      signalsNoted: [
        { signal: 'Ran the leads sync — possible leadership signal, not claimed', sourceQuote: 'I also ran the weekly leads sync' },
        { signal: 'Invented signal', sourceQuote: 'I managed the entire department' },
      ],
    });
    expect(signalsNoted).toHaveLength(1);
    expect(rejected.some((r) => r.reason.match(/Signal quote/))).toBe(true);
  });

  it('signals are stripped during calibration hold and the admin resurface list sees them (C9 hook)', async () => {
    const card = await structuredCard('Signal Card');
    await Card.updateOne(
      { _id: card._id },
      { signalsNoted: [{ signal: 'Review authority seen', sourceQuote: 'I run it daily on GCash since April.', at: new Date() }], calibrationHold: true },
    );

    const talentView = await agents.talentA.get(`/api/cards/${card._id}`);
    expect(talentView.body.data.signalsNoted).toEqual([]);
    expect(talentView.body.data.inCalibration).toBe(true);

    const resurface = await agents.admin.get('/api/admin/signals');
    expect(resurface.status).toBe(200);
    const row = resurface.body.data.find((r) => r.subject.name === 'Signal Card');
    expect(row.signalsNoted[0].signal).toBe('Review authority seen');

    expect((await agents.talentA.get('/api/admin/signals')).status).toBe(403);
    await Card.updateOne({ _id: card._id }, { calibrationHold: false });
  });
});

describe('A4 draft lifecycle — archive, never delete', () => {
  async function idleDraft(name, idleDays) {
    const card = (await agents.talentA.post('/api/cards').send({ subjectName: name })).body.data;
    await agents.talentA.patch(`/api/cards/${card._id}`).send({
      rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'Precious words that must never vanish.' }],
    });
    await Card.collection.updateOne(
      { _id: (await Card.findById(card._id))._id },
      { $set: { updatedAt: new Date(Date.now() - idleDays * DAY_MS) } },
    );
    return card;
  }

  it('one nudge before, archive at 90 — raw answers untouched; then revive', async () => {
    const card = await idleDraft('Sleepy Draft', 85);

    const first = await runLifecyclePass();
    expect(first.find((o) => String(o.cardId) === String(card._id)).outcome).toBe('nudged');
    // The nudge is ONE-time.
    expect(await runLifecyclePass()).not.toContainEqual(expect.objectContaining({ cardId: expect.anything(), outcome: 'nudged' }));

    await Card.collection.updateOne(
      { _id: (await Card.findById(card._id))._id },
      { $set: { updatedAt: new Date(Date.now() - 91 * DAY_MS) } },
    );
    const second = await runLifecyclePass();
    expect(second.find((o) => String(o.cardId) === String(card._id)).outcome).toBe('archived');

    const archived = await Card.findById(card._id);
    expect(archived.status).toBe('archived');
    expect(archived.archivedFrom).toBe('draft');
    expect(archived.rawAnswers[0].answer).toBe('Precious words that must never vanish.'); // Invariant 15

    const revived = await agents.talentA.post(`/api/cards/${card._id}/revive`);
    expect(revived.status).toBe(200);
    expect(revived.body.data.status).toBe('draft');
    expect(revived.body.data.rawAnswers[0].answer).toBe('Precious words that must never vanish.');
  });

  it('submitted drafts never archive — they are in flight, not idle', async () => {
    const card = await idleDraft('Submitted Draft', 95);
    await Card.updateOne({ _id: card._id }, { submittedForStructuringAt: new Date() });
    await Card.collection.updateOne(
      { _id: (await Card.findById(card._id))._id },
      { $set: { updatedAt: new Date(Date.now() - 95 * DAY_MS) } },
    );
    const outcomes = await runLifecyclePass();
    expect(outcomes.find((o) => String(o.cardId) === String(card._id))).toBeUndefined();
  });

  it('a confirmed card\'s archive never revives', async () => {
    const card = await structuredCard('Confirmed Archive');
    const stored = await Card.findById(card._id);
    stored.claims[0].talentApproved = true;
    stored.claims[0].verdict = 'Confirmed';
    await transition(stored, 'talent-approved', ctx.users.talentA._id);
    await transition(stored, 'routed', ctx.users.talentA._id);
    await transition(stored, 'confirmed', ctx.users.talentA._id);
    stored.archivedFrom = 'confirmed';
    await transition(stored, 'archived', ctx.users.talentA._id);
    await stored.save();

    const res = await agents.talentA.post(`/api/cards/${card._id}/revive`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/stays on the record/);
  });
});
