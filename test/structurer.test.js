/**
 * P3: the FR-10 validation layer, the AC-8 failure posture of the
 * structuring worker, and the FR-11 calibration flow — all against a
 * mocked Anthropic client (no API calls; the pack semantics themselves
 * are calibrated by JP in Claude Projects, not asserted here).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { makeTestContext } from './helpers/testApp.js';
import { Track } from '../src/models/Track.js';
import { Card } from '../src/models/Card.js';
import { validateStructuredOutput, buildOutputSchema } from '../src/services/structurerService.js';
import { structureOne } from '../src/workers/structurerWorker.js';

let ctx;
let talent;
let admin;
let track;

const VOCAB = {
  competencyOrDomainList: ['build-ops', 'file-hygiene'],
  controlledVocabulary: {
    execution: ['I run it', 'Someone checks behind me'],
    decision: ['I decided', 'Someone else decided'],
  },
};

function fakeClient(result) {
  return {
    messages: {
      create: async () => {
        if (result instanceof Error) throw result;
        if (result === 'refusal') return { stop_reason: 'refusal', content: [] };
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    },
  };
}

async function submittedCard(agent, subjectName = 'GCash') {
  const card = (await agent.post('/api/cards').send({ subjectName, closeDate: '2026-06-30' })).body.data;
  await agent.patch(`/api/cards/${card._id}`).send({
    rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'I run it weekly. Miguel checks behind me before release.' }],
    sweepAnswers: [{ prompt: 'Sweep', answer: 'Not me for the rest.' }],
  });
  await agent.post(`/api/cards/${card._id}/submit`);
  return Card.findById(card._id);
}

const GOOD_CLAIM = {
  type: 'claim',
  competencyOrDomain: 'build-ops',
  labels: { execution: 'I run it' },
  sourceQuote: 'I run it weekly.',
  flags: [],
};

beforeAll(async () => {
  ctx = await makeTestContext();
  talent = await ctx.loginAs(ctx.users.talentA);
  admin = await ctx.loginAs(ctx.users.admin);
});

beforeEach(async () => {
  track = await Track.findOneAndUpdate(
    { key: 'ops' },
    {
      packText: 'TEST PACK — ported verbatim',
      vocabPackVersion: 'v0.2-test',
      competencyOrDomainList: VOCAB.competencyOrDomainList,
      controlledVocabulary: VOCAB.controlledVocabulary,
      calibrationMode: true,
    },
    { returnDocument: 'after' },
  );
});

afterAll(() => ctx.teardown());

describe('FR-10 validation layer (fails closed)', () => {
  const cardStub = {
    rawAnswers: [{ answer: 'I run it weekly. Miguel checks behind me before release.' }],
    sweepAnswers: [{ answer: 'Not me for the rest.' }],
  };

  it('accepts an on-vocabulary claim whose quote is verbatim', () => {
    const { claims, rejected } = validateStructuredOutput(track, cardStub, { claims: [GOOD_CLAIM], followUps: [] });
    expect(claims).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    expect(claims[0].talentApproved).toBe(false);
    expect(claims[0].verdict).toBe(null);
  });

  it('rejects an off-vocabulary competency', () => {
    const { claims, rejected } = validateStructuredOutput(track, cardStub, {
      claims: [{ ...GOOD_CLAIM, competencyOrDomain: 'invented-competency' }],
      followUps: [],
    });
    expect(claims).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/Off-vocabulary/);
  });

  it('rejects an off-vocabulary label value — regardless of what the model returns', () => {
    const { claims, rejected } = validateStructuredOutput(track, cardStub, {
      claims: [{ ...GOOD_CLAIM, labels: { execution: 'Level 4 senior' } }],
      followUps: [],
    });
    expect(claims).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/not in the controlled vocabulary/);
  });

  it('rejects a fabricated source quote (Invariant 9)', () => {
    const { claims, rejected } = validateStructuredOutput(track, cardStub, {
      claims: [{ ...GOOD_CLAIM, sourceQuote: 'I single-handedly built everything' }],
      followUps: [],
    });
    expect(claims).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/quote/);
  });

  it('drops NOT-CLAIMED entirely — no claim, no state (Invariant 7 / AC-6)', () => {
    const { claims } = validateStructuredOutput(track, cardStub, {
      claims: [{ ...GOOD_CLAIM, flags: ['NOT-CLAIMED'] }],
      followUps: [],
    });
    expect(claims).toHaveLength(0);
  });

  it('silence yields nothing: no claims in → no claims out, no synthesized state (AC-6)', () => {
    const { claims, rejected } = validateStructuredOutput(track, cardStub, { claims: [], followUps: [] });
    expect(claims).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it('caps follow-ups at two (FR-9)', () => {
    const { followUps } = validateStructuredOutput(track, cardStub, {
      claims: [],
      followUps: ['Who owned the call?', 'Which account was that?', 'A third question'],
    });
    expect(followUps).toHaveLength(2);
  });

  it('the output schema has no level field to fill (Invariant 10, structural)', () => {
    const schema = buildOutputSchema(track);
    const claimProps = Object.keys(schema.properties.claims.items.properties);
    for (const forbidden of ['level', 'tier', 'rung', 'texture', 'rank', 'readiness']) {
      expect(claimProps).not.toContain(forbidden);
    }
    expect(schema.properties.claims.items.properties.competencyOrDomain.enum).toEqual(VOCAB.competencyOrDomainList);
  });
});

describe('structuring worker (AC-8: kill the AI, raw intact, retry succeeds)', () => {
  it('AI failure leaves the card in draft with raw intact; retry then succeeds', async () => {
    const card = await submittedCard(talent, 'Fail Then Retry');

    const failed = await structureOne(card, { client: fakeClient(new Error('socket hang up')) });
    expect(failed.outcome).toBe('failed');

    let stored = await Card.findById(card._id);
    expect(stored.status).toBe('draft');
    expect(stored.rawAnswers[0].answer).toMatch(/I run it weekly/);
    expect(stored.structuringAttempts).toBe(1);
    expect(stored.structuringError).toMatch(/socket hang up/);

    stored.nextStructuringAttemptAt = null; // fast-forward the backoff
    await stored.save();
    const retried = await structureOne(stored, { client: fakeClient({ claims: [GOOD_CLAIM], followUps: [] }) });
    expect(retried.outcome).toBe('structured');

    stored = await Card.findById(card._id);
    expect(stored.status).toBe('structured');
    expect(stored.claims).toHaveLength(1);
    expect(stored.packVersion).toBe('v0.2-test');
    expect(stored.rawAnswers[0].answer).toMatch(/I run it weekly/); // raw never lost
  });

  it('a refusal is a retryable failure, not a crash', async () => {
    const card = await submittedCard(talent, 'Refusal Case');
    const result = await structureOne(card, { client: fakeClient('refusal') });
    expect(result.outcome).toBe('failed');
    expect((await Card.findById(card._id)).status).toBe('draft');
  });

  it('without a loaded pack, structuring waits — it never invents vocabulary (Invariant 1)', async () => {
    await Track.updateOne({ key: 'ops' }, { packText: null, vocabPackVersion: null, competencyOrDomainList: [] });
    const card = await submittedCard(talent, 'No Pack Yet');
    const result = await structureOne(card, { client: fakeClient({ claims: [GOOD_CLAIM], followUps: [] }) });
    expect(result.outcome).toBe('awaiting-pack');
    expect((await Card.findById(card._id)).status).toBe('draft');
  });

  it('calibration mode ON puts the structured card on hold (FR-11)', async () => {
    const card = await submittedCard(talent, 'Calibrated Card');
    await structureOne(card, { client: fakeClient({ claims: [GOOD_CLAIM], followUps: [] }) });
    expect((await Card.findById(card._id)).calibrationHold).toBe(true);
  });

  it('calibration mode OFF releases directly to the talent', async () => {
    await Track.updateOne({ key: 'ops' }, { calibrationMode: false });
    const card = await submittedCard(talent, 'Post-Gate Card');
    await structureOne(card, { client: fakeClient({ claims: [GOOD_CLAIM], followUps: [] }) });
    expect((await Card.findById(card._id)).calibrationHold).toBe(false);
  });
});

describe('calibration queue (FR-11)', () => {
  let held;

  beforeEach(async () => {
    held = await submittedCard(talent, `Held ${Date.now()}`);
    await structureOne(held, { client: fakeClient({ claims: [GOOD_CLAIM], followUps: [] }) });
    held = await Card.findById(held._id);
  });

  it('the talent cannot see claims while the card holds', async () => {
    const res = await talent.get(`/api/cards/${held._id}`);
    expect(res.body.data.claims).toHaveLength(0);
    expect(res.body.data.inCalibration).toBe(true);
  });

  it('admin sees the held card in the queue, with claims', async () => {
    const res = await admin.get('/api/admin/calibration');
    const found = res.body.data.find((c) => c._id === held._id.toString());
    expect(found).toBeTruthy();
    expect(found.claims).toHaveLength(1);
  });

  it('an admin correction is validated (FR-10 applies to JP too) and audited', async () => {
    const claimId = held.claims[0]._id.toString();

    const bad = await admin.post(`/api/admin/calibration/${held._id}/claims/${claimId}`).send({
      action: 'edit',
      labels: { execution: 'Definitely a level 5' },
    });
    expect(bad.status).toBe(400);

    const good = await admin.post(`/api/admin/calibration/${held._id}/claims/${claimId}`).send({
      action: 'edit',
      labels: { execution: 'Someone checks behind me' },
    });
    expect(good.status).toBe(200);
    expect(good.body.data.claims[0].labels.execution).toBe('Someone checks behind me');

    const audit = await admin.get(`/api/admin/audit?entity=card&entityId=${held._id}`);
    expect(audit.body.data.some((e) => e.action === 'card.calibration-edit')).toBe(true);
  });

  it('release makes the claims visible to the talent', async () => {
    await admin.post(`/api/admin/calibration/${held._id}/release`);
    const res = await talent.get(`/api/cards/${held._id}`);
    expect(res.body.data.claims).toHaveLength(1);
    expect(res.body.data.inCalibration).toBeUndefined();
  });

  it('non-admins cannot touch the calibration surface', async () => {
    expect((await talent.get('/api/admin/calibration')).status).toBe(403);
    expect((await talent.post(`/api/admin/calibration/${held._id}/release`)).status).toBe(403);
  });
});
