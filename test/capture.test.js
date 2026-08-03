/**
 * P2 capture: autosave persistence (Invariant 15 / AC-8 semantics),
 * sweep gating (FR-8), period tag (FR-4/NFR-5), pre-fill boundary (FR-6),
 * and immutability of vocab packs + audit log.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext } from './helpers/testApp.js';
import { periodTagFor } from '../src/utils/periodTag.js';
import { VocabPackVersion } from '../src/models/VocabPackVersion.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Card } from '../src/models/Card.js';

let ctx;
let talent;

beforeAll(async () => {
  ctx = await makeTestContext();
  talent = await ctx.loginAs(ctx.users.talentA);
});

afterAll(() => ctx.teardown());

describe('drafts + autosave (FR-4, Invariant 15)', () => {
  it('raw answers persist on every autosave, before any structuring exists', async () => {
    const card = (await talent.post('/api/cards').send({ subjectName: 'GCash', closeDate: '2026-06-15' })).body.data;
    await talent.patch(`/api/cards/${card._id}`).send({
      rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'Kinukuha ko ang weekly builds' }],
    });
    const stored = await Card.findById(card._id);
    expect(stored.rawAnswers[0].answer).toBe('Kinukuha ko ang weekly builds');
  });

  it('a talent can hold multiple drafts', async () => {
    await talent.post('/api/cards').send({ subjectName: 'Draft 2' });
    await talent.post('/api/cards').send({ subjectName: 'Draft 3' });
    const res = await talent.get('/api/home');
    expect(res.body.data.drafts.length).toBeGreaterThanOrEqual(3);
  });
});

describe('submit + structuring boundary (AC-8 semantics)', () => {
  async function readyCard() {
    const card = (await talent.post('/api/cards').send({ subjectName: 'Submit Subject', closeDate: '2026-06-15' })).body.data;
    await talent.patch(`/api/cards/${card._id}`).send({
      rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'I run the builds' }],
      sweepAnswers: [{ prompt: 'Anything else?', answer: 'Not me for the rest' }],
    });
    return card;
  }

  it('submit without a sweep answer is refused — the sweep comes after the answers (FR-8)', async () => {
    const card = (await talent.post('/api/cards').send({ subjectName: 'No Sweep' })).body.data;
    await talent.patch(`/api/cards/${card._id}`).send({
      rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'answer' }],
    });
    const res = await talent.post(`/api/cards/${card._id}/submit`);
    expect(res.status).toBe(400);
  });

  it('submit persists raw, stays retryable, and reports structuring pending (P3)', async () => {
    const card = await readyCard();
    const res = await talent.post(`/api/cards/${card._id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.data.structuring).toBe('pending-p3');

    const stored = await Card.findById(card._id);
    expect(stored.status).toBe('draft'); // no claims yet — structurer will move it
    expect(stored.rawAnswers[0].answer).toBe('I run the builds'); // raw intact
    expect(stored.submittedForStructuringAt).toBeTruthy();

    // Retry does not lose anything (AC-8: kill the AI, retry succeeds)
    const retry = await talent.post(`/api/cards/${card._id}/submit`);
    expect(retry.status).toBe(200);
    expect((await Card.findById(card._id)).rawAnswers).toHaveLength(1);
  });
});

describe('period tag (FR-4, NFR-5 — Asia/Manila regardless of server TZ)', () => {
  it('quarter comes from the close date in Manila time', () => {
    expect(periodTagFor(new Date('2026-06-15T00:00:00+08:00'))).toBe('2026-Q2');
    expect(periodTagFor(new Date('2026-01-01T00:00:00+08:00'))).toBe('2026-Q1');
  });

  it('a UTC timestamp that is already next-quarter in Manila tags the Manila quarter', () => {
    // 2026-03-31 23:00 UTC == 2026-04-01 07:00 Manila → Q2
    expect(periodTagFor(new Date('2026-03-31T23:00:00Z'))).toBe('2026-Q2');
  });

  it('period tag ignores the filing date entirely', async () => {
    const card = (await talent.post('/api/cards').send({ subjectName: 'Old close', closeDate: '2025-11-20' })).body.data;
    expect(card.periodTag).toBe('2025-Q4'); // filed 2026, tagged by close date
  });
});

describe('pre-fill boundary (FR-6 / Invariant 11)', () => {
  it('context returns confirmed cards only, and creating a draft never copies content', async () => {
    const res = await talent.get('/api/cards/context');
    expect(res.status).toBe(200);
    for (const c of res.body.data) expect(c.status).toBe('confirmed');

    const fresh = (await talent.post('/api/cards').send({ subjectName: 'GCash' })).body.data;
    expect(fresh.rawAnswers).toHaveLength(0); // nothing pre-fills an answer field
  });
});

describe('immutability (Invariants 1, 17)', () => {
  it('vocab pack versions reject updates', async () => {
    const pack = await VocabPackVersion.create({ trackKey: 'ops', version: 'vX', packText: 'T' });
    await expect(
      VocabPackVersion.updateOne({ _id: pack._id }, { packText: 'tampered' }),
    ).rejects.toThrow(/immutable/);
    pack.packText = 'tampered';
    await expect(pack.save()).rejects.toThrow(/immutable/);
  });

  it('audit log rejects updates and deletes', async () => {
    const entry = await AuditLog.create({
      actorId: ctx.users.admin._id, action: 'x', entity: 'card',
    });
    await expect(AuditLog.updateOne({ _id: entry._id }, { action: 'y' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteOne({ _id: entry._id })).rejects.toThrow(/append-only/);
  });
});
