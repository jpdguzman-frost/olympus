/**
 * B1 (Amendment 1 §A6/§A7 + Rulings C6/OD-2): the vocab/behavior split,
 * the two-layer flag rule, and the admin-assignable role settings.
 *
 *  - A vocab-only pack without a published behavior spec NEVER structures
 *    (fails closed — a rule-less prompt must be impossible).
 *  - The system prompt in split mode composes behavior spec + pack §B/§C;
 *    behavior text is DATA from the store, never a hard-coded string.
 *  - C6: the AI may only output the pack's claim-level flags; the
 *    card/system layer (STALE, THIN-POOL, …) is server-attached only.
 *  - Behavior specs are append-only, like vocab packs.
 *  - OD-2: fallback reviewer / exposure verifier are admin settings,
 *    validated against active users, audited.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { makeTestContext } from './helpers/testApp.js';
import { Track } from '../src/models/Track.js';
import { BehaviorSpecVersion } from '../src/models/BehaviorSpecVersion.js';
import { AuditLog } from '../src/models/AuditLog.js';
import {
  trackReadyForStructuring,
  trackClaimFlags,
  composeSystemPrompt,
  structureCard,
  validateStructuredOutput,
  buildOutputSchema,
} from '../src/services/structurerService.js';
import { FLAG_VOCABULARY } from '../src/config/constants.js';

let ctx;
let admin;
let talent;

const CLAIM_FLAGS = ['insufficient detail — draft', 'designed, not held — doesn’t lift level'];

const SPLIT_TRACK_FIELDS = {
  packText: '## SECTION B — CONTROLLED VOCABULARY\n(vocab)\n## SECTION C — SCHEMA\n(schema)',
  vocabPackVersion: 'v0.4-test',
  packMode: 'vocab-only',
  competencyOrDomainList: ['build-ops'],
  controlledVocabulary: { execution: ['I run it'] },
  claimFlags: CLAIM_FLAGS,
};

function fakeClient(capture) {
  return {
    messages: {
      create: async (params) => {
        capture.params = params;
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ claims: [], followUps: [] }) }],
        };
      },
    },
  };
}

const CARD_STUB = {
  subject: { kind: 'project', name: 'Test' },
  closeDate: null,
  rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'I run it daily.' }],
  sweepAnswers: [{ prompt: 'Sweep', answer: 'Not me for the rest.' }],
};

beforeAll(async () => {
  ctx = await makeTestContext();
  admin = await ctx.loginAs(ctx.users.admin);
  talent = await ctx.loginAs(ctx.users.talentA);
});

beforeEach(async () => {
  await Track.updateOne(
    { key: 'ops' },
    { ...SPLIT_TRACK_FIELDS, behaviorSpecVersion: null, behaviorSpecText: null },
  );
});

afterAll(() => ctx.teardown());

describe('Split mode readiness (fails closed)', () => {
  it('a vocab-only pack without a behavior spec is NOT ready to structure', async () => {
    const track = await Track.findOne({ key: 'ops' });
    expect(trackReadyForStructuring(track)).toBe(false);
  });

  it('publishing a behavior spec makes it ready', async () => {
    await Track.updateOne({ key: 'ops' }, { behaviorSpecVersion: 'v2-test', behaviorSpecText: 'BEHAVIOR RULES' });
    const track = await Track.findOne({ key: 'ops' });
    expect(trackReadyForStructuring(track)).toBe(true);
  });

  it('legacy packs (A&A until its v0.4) are ready without a behavior spec', async () => {
    await Track.updateOne(
      { key: 'artasset' },
      { packText: 'FULL LEGACY PACK', vocabPackVersion: 'v0.3-test', packMode: 'legacy', competencyOrDomainList: ['Seed'] },
    );
    const track = await Track.findOne({ key: 'artasset' });
    expect(trackReadyForStructuring(track)).toBe(true);
  });
});

describe('System prompt composition (A7)', () => {
  it('split mode sends behavior spec + pack §B/§C, in that order', async () => {
    await Track.updateOne({ key: 'ops' }, { behaviorSpecVersion: 'v2-test', behaviorSpecText: 'BEHAVIOR RULES FROM STORE' });
    const track = await Track.findOne({ key: 'ops' });
    const capture = {};
    await structureCard(track, CARD_STUB, { client: fakeClient(capture) });
    const system = capture.params.system;
    expect(system).toContain('BEHAVIOR RULES FROM STORE');
    expect(system).toContain('## SECTION B');
    expect(system.indexOf('BEHAVIOR RULES FROM STORE')).toBeLessThan(system.indexOf('## SECTION B'));
  });

  it('legacy mode sends the pack verbatim as the whole prompt', async () => {
    const track = { packMode: 'legacy', packText: 'THE WHOLE LEGACY PACK' };
    expect(composeSystemPrompt(track)).toBe('THE WHOLE LEGACY PACK');
  });
});

describe('C6 two-layer flags', () => {
  it('the AI flag enum is the pack claim-flag list when present, legacy FLAG_VOCABULARY otherwise', async () => {
    const track = await Track.findOne({ key: 'ops' });
    expect(trackClaimFlags(track)).toEqual(CLAIM_FLAGS);
    expect(trackClaimFlags({ claimFlags: [] })).toEqual(FLAG_VOCABULARY);
    const schema = buildOutputSchema(track);
    expect(schema.properties.claims.items.properties.flags.items.enum).toEqual(CLAIM_FLAGS);
  });

  it('validation keeps pack claim flags and drops card/system flags from AI output', async () => {
    const track = await Track.findOne({ key: 'ops' });
    const { claims } = validateStructuredOutput(track, CARD_STUB, {
      claims: [{
        type: 'claim',
        competencyOrDomain: 'build-ops',
        labels: { execution: 'I run it' },
        sourceQuote: 'I run it daily.',
        flags: ['insufficient detail — draft', 'STALE', 'THIN-POOL'],
      }],
      followUps: [],
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].flags).toEqual(['insufficient detail — draft']);
  });
});

describe('Behavior spec store (append-only, like vocab packs)', () => {
  it('rejects every update path', async () => {
    await BehaviorSpecVersion.create({ trackKey: 'ops', version: 'vx-immutable', text: 'original' });
    await expect(
      BehaviorSpecVersion.updateOne({ version: 'vx-immutable' }, { text: 'rewritten' }),
    ).rejects.toThrow(/immutable/);
    await expect(BehaviorSpecVersion.deleteOne({ version: 'vx-immutable' })).rejects.toThrow(/immutable/);
    const doc = await BehaviorSpecVersion.findOne({ version: 'vx-immutable' });
    doc.text = 'rewritten';
    await expect(doc.save()).rejects.toThrow(/immutable/);
  });

  it('admin publishes a spec version through the API; the track repoints; audited', async () => {
    const res = await admin
      .post('/api/admin/tracks/ops/behavior-spec')
      .send({ version: 'v2-api-test', text: 'RULES VIA API' });
    expect(res.status).toBe(201);
    expect(res.body.data.behaviorSpecVersion).toBe('v2-api-test');
    const stored = await BehaviorSpecVersion.findOne({ trackKey: 'ops', version: 'v2-api-test' });
    expect(stored.text).toBe('RULES VIA API');
    const audit = await AuditLog.findOne({ action: 'track.behavior-spec-publish' }).sort({ createdAt: -1 });
    expect(audit).not.toBe(null);
  });

  it('non-admin cannot publish a behavior spec', async () => {
    const res = await talent
      .post('/api/admin/tracks/ops/behavior-spec')
      .send({ version: 'v2-nope', text: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('OD-2 role settings', () => {
  it('admin assigns fallback reviewer + exposure verifier; audited', async () => {
    const res = await admin.patch('/api/admin/tracks/ops/settings').send({
      fallbackReviewerId: String(ctx.users.reviewer._id),
      exposureVerifierId: String(ctx.users.lead._id),
    });
    expect(res.status).toBe(200);
    expect(String(res.body.data.fallbackReviewerId)).toBe(String(ctx.users.reviewer._id));
    expect(String(res.body.data.exposureVerifierId)).toBe(String(ctx.users.lead._id));
    const audit = await AuditLog.findOne({ action: 'track.settings' }).sort({ createdAt: -1 });
    expect(audit).not.toBe(null);
  });

  it('clears a setting with null', async () => {
    await admin.patch('/api/admin/tracks/ops/settings').send({ fallbackReviewerId: String(ctx.users.reviewer._id) });
    const res = await admin.patch('/api/admin/tracks/ops/settings').send({ fallbackReviewerId: null });
    expect(res.status).toBe(200);
    expect(res.body.data.fallbackReviewerId).toBe(null);
  });

  it('rejects an unknown or deactivated user', async () => {
    const unknown = await admin
      .patch('/api/admin/tracks/ops/settings')
      .send({ fallbackReviewerId: '64b000000000000000000000' });
    expect(unknown.status).toBe(400);

    await admin.patch(`/api/admin/users/${ctx.users.talentB._id}`).send({ active: false });
    const inactive = await admin
      .patch('/api/admin/tracks/ops/settings')
      .send({ fallbackReviewerId: String(ctx.users.talentB._id) });
    expect(inactive.status).toBe(400);
    await admin.patch(`/api/admin/users/${ctx.users.talentB._id}`).send({ active: true });
  });

  it('non-admin cannot touch settings', async () => {
    const res = await talent.patch('/api/admin/tracks/ops/settings').send({ fallbackReviewerId: null });
    expect(res.status).toBe(403);
  });
});
