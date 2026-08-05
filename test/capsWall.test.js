/**
 * B5 (Amendment 1 §A2): the CAPS hard wall — Invariant-18-to-be.
 *
 * Load-bearing assertions:
 *  - Import is whitelist-only: banned columns (weights, scores,
 *    difficulty, credit fractions, numeric review twins) are named in
 *    the batch record and NEVER stored; the mirror schema throws on
 *    unknown keys by construction.
 *  - Exposure auto-verifies on 3+ DISTINCT review weeks — weeks of
 *    exposure, never review-count-as-authority. Below threshold or no
 *    CAPS → the human sign-off path. CAPS is an accelerator, never a
 *    gate.
 *  - The capture scaffold and the structurer input carry task names,
 *    categories, dates, tenure — and no value data (there is none to
 *    carry).
 *  - Catch-up lists projects + tenure only. No task counts (volume).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext, talentApproveFixture } from './helpers/testApp.js';
import { CapsTaskRow } from '../src/models/CapsTaskRow.js';
import { Track } from '../src/models/Track.js';
import { User } from '../src/models/User.js';
import { extractRows } from '../scripts/import-caps.js';
import { reviewExposure, taskScaffold, catchUpProjects, tenureFor } from '../src/services/capsService.js';
import { structureCard } from '../src/services/structurerService.js';

let ctx;
let agents;

const FIXTURE_CSV = [
  // duplicate review headers: first set = names, second set = numeric twins (like the real sheet)
  'Task name,Project Name,URL,Contributor,Tags,Peer Review,Design Review,Category,Difficulty,Task Weight,Contribution Weight,Final Score,Peer Review,Design Review,Date,Week',
  'MC-1 Billers Page,GCash App,https://x,Karen Ong,"design,hard",-,Clarence Profeta,design: screen,difficulty: hard,7.00,1.00,7.00,0.00,3.00,1/5/2026,2',
  'MC-2 Wallet Screen,GCash App,https://x,Karen Ong,,Miles Alba,-,design: screen,difficulty: easy,2.00,0.25,0.50,1.00,0.00,1/12/2026,3',
  'MC-3 Promo Cards,GCash App,https://x,Karen Ong,,Miles Alba,-,design: screen,difficulty: easy,2.00,1.00,2.00,1.00,0.00,1/19/2026,4',
  'MC-4 Boost Page,GCash App,https://x,Karen Ong,,Miles Alba,-,design: screen,difficulty: easy,2.00,1.00,2.00,1.00,0.00,1/26/2026,5',
  'MC-5 Solo Task,Sun Life EDM,https://x,Karen Ong,,-,-,content: writing,difficulty: easy,1.00,1.00,1.00,0.00,0.00,2/2/2026,6',
  'MC-6 Other Person,GCash App,https://x,Roni Angelie Inocencio,,-,-,design: screen,difficulty: easy,1,1,1,0,0,2/2/2026,6',
].join('\n');

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = {
    talentA: await ctx.loginAs(ctx.users.talentA),
    lead: await ctx.loginAs(ctx.users.lead),
  };
  await Track.updateOne(
    { key: 'ops' },
    {
      packText: 'TEST PACK',
      vocabPackVersion: 'v-test',
      competencyOrDomainList: ['placeholder-from-pack', 'build-ops'],
      controlledVocabulary: { execution: ['I run it'] },
      calibrationMode: false,
      exposureVerifierId: ctx.users.lead._id,
    },
  );
  // Map identities: CAPS speaks names.
  await User.updateOne({ _id: ctx.users.talentA._id }, { capsName: 'Karen Ong' });
  await User.updateOne({ _id: ctx.users.reviewer._id }, { capsName: 'Miles Alba' });

  // Load the fixture through the real boundary.
  const { rows } = extractRows(FIXTURE_CSV);
  await CapsTaskRow.insertMany(rows.map((r) => ({ ...r, batchId: 'test-batch' })));
});

afterAll(() => ctx.teardown());

describe('the import boundary (whitelist, not blocklist)', () => {
  it('reads only whitelisted columns; banned ones are named as dropped, never stored', () => {
    const { rows, droppedColumns } = extractRows(FIXTURE_CSV);
    expect(droppedColumns).toEqual(expect.arrayContaining(['Task Weight', 'Contribution Weight', 'Final Score', 'Difficulty', 'URL', 'Tags']));
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['category', 'contributorName', 'date', 'projectName', 'reviewers', 'taskName', 'week'].sort(),
      );
    }
  });

  it('reviewer names come from the FIRST (name) columns, never the numeric twins', () => {
    const { rows } = extractRows(FIXTURE_CSV);
    const first = rows.find((r) => r.taskName.startsWith('MC-1'));
    expect(first.reviewers).toEqual([{ type: 'Design Review', name: 'Clarence Profeta' }]);
    // the twin columns held 0.00/3.00 — no numeric value ever parsed as a reviewer
    expect(first.reviewers.some((r) => /^\d/.test(r.name))).toBe(false);
  });

  it('applies the canonical aliases', () => {
    const { rows } = extractRows(FIXTURE_CSV);
    expect(rows.some((r) => r.contributorName === 'August Inocencio')).toBe(true);
    expect(rows.some((r) => r.contributorName === 'Roni Angelie Inocencio')).toBe(false);
  });

  it('the mirror schema throws on any non-whitelisted key — the wall is structural', async () => {
    await expect(
      CapsTaskRow.create({
        batchId: 'x', taskName: 'x', projectName: 'x', contributorName: 'x',
        finalScore: 9.5, // banned
      }),
    ).rejects.toThrow();
  });
});

describe('exposure auto-verify (A1 via A2)', () => {
  it('3+ distinct review weeks verifies; fewer does not', async () => {
    expect(await reviewExposure('Karen Ong', 'Miles Alba', 'GCash App')).toEqual({ weeks: 3, verified: true });
    expect((await reviewExposure('Karen Ong', 'Clarence Profeta', 'GCash App')).verified).toBe(false);
    expect((await reviewExposure('Karen Ong', 'Miles Alba', 'Sun Life EDM')).verified).toBe(false);
  });

  it('an auto-verified pick routes straight to the nominee — no sign-off stop', async () => {
    const card = (await agents.talentA.post('/api/cards').send({ subjectName: 'GCash App', closeDate: '2026-06-30' })).body.data;
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeId: ctx.users.reviewer._id.toString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('routed');
    expect(res.body.data.nomination.systemChecks.exposure).toMatch(/auto-verified.*3 different weeks/);
    expect(res.body.data.nomination.routedTo).toBe(ctx.users.reviewer._id.toString());
  });

  it('below threshold the pick takes the human sign-off path', async () => {
    const card = (await agents.talentA.post('/api/cards').send({ subjectName: 'Sun Life EDM', closeDate: '2026-06-30' })).body.data;
    await talentApproveFixture(card._id, ctx.users.talentA._id);
    const res = await agents.talentA.post(`/api/cards/${card._id}/nominate`).send({
      nomineeId: ctx.users.reviewer._id.toString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('exposure-signoff');
  });
});

describe('scaffold + catch-up carry no value data', () => {
  it('the task scaffold holds names, categories, dates, tenure — nothing else', async () => {
    const scaffold = await taskScaffold('Karen Ong', 'GCash App');
    expect(scaffold.tasks.length).toBeGreaterThan(0);
    for (const task of scaffold.tasks) {
      expect(Object.keys(task).sort()).toEqual(['category', 'date', 'taskName'].sort());
    }
    expect(JSON.stringify(scaffold)).not.toMatch(/weight|score|difficulty|band|total/i);
  });

  it('tenure is first → last task date', async () => {
    const tenure = await tenureFor('Karen Ong', 'GCash App');
    expect(tenure.from.toISOString().slice(0, 10)).toBe('2026-01-05');
    expect(tenure.to.toISOString().slice(0, 10)).toBe('2026-01-26');
  });

  it('catch-up lists uncarded projects with tenure and NO task counts', async () => {
    const talent = await User.findById(ctx.users.talentA._id);
    const projects = await catchUpProjects(talent, {});
    const sunLife = projects.find((p) => p.projectName === 'Sun Life EDM');
    // GCash App got cards in the tests above — it must not offer a catch-up.
    expect(projects.some((p) => p.projectName === 'GCash App')).toBe(false);
    expect(sunLife).toBeUndefined(); // carded above too
    for (const p of projects) {
      expect(Object.keys(p).sort()).toEqual(['projectName', 'tenure'].sort());
    }
  });

  it('the structurer input carries the scaffold and no value words', async () => {
    const track = await Track.findOne({ key: 'ops' });
    const scaffold = await taskScaffold('Karen Ong', 'GCash App');
    const capture = {};
    const client = {
      messages: {
        create: async (params) => {
          capture.params = params;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ claims: [], followUps: [], signalsNoted: [] }) }] };
        },
      },
    };
    await structureCard(
      track,
      {
        subject: { kind: 'project', name: 'GCash App' },
        closeDate: null,
        rawAnswers: [{ questionIndex: 0, question: 'Q1', answer: 'I ran the billers page work.' }],
        sweepAnswers: [],
      },
      { client, capsScaffold: scaffold },
    );
    const content = capture.params.messages[0].content;
    expect(content).toContain('CAPS MEMORY SCAFFOLD');
    expect(content).toContain('MC-1 Billers Page');
    expect(content).not.toMatch(/weight|final score|difficulty: /i);
  });
});
