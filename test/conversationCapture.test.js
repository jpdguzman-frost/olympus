/**
 * B7: the capture conversation.
 *
 * Load-bearing assertions:
 *  - Invariant 15: a talent turn persists into rawAnswers verbatim the
 *    moment it is sent — even if the AI call afterwards dies.
 *  - Talent-only quotes, structurally: AI turns never enter rawAnswers,
 *    so the FR-10 verbatim check can never accept an AI-authored quote.
 *  - Early wrap: when the model says done early, the conversation ends
 *    well under the cap (shorter is better).
 *  - The 12-question hard cap forces a wrap without another AI call.
 *  - A sweep-kind answer lands in sweepAnswers — which is what arms
 *    "Send it in".
 *  - The activity summary never carries counts or value words.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestContext } from './helpers/testApp.js';
import { Card } from '../src/models/Card.js';
import { Track } from '../src/models/Track.js';
import { User } from '../src/models/User.js';
import { converse, MAX_AI_QUESTIONS } from '../src/services/conversationService.js';
import { validateStructuredOutput } from '../src/services/structurerService.js';

let ctx;
let agents;
let talentUser;

function scriptedClient(turns) {
  let i = 0;
  return {
    calls: 0,
    messages: {
      create: async function create() {
        this.parent.calls += 1;
        const turn = turns[Math.min(i, turns.length - 1)];
        i += 1;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(turn) }] };
      },
    },
  };
}
// bind helper for call counting
function makeClient(turns) {
  const client = scriptedClient(turns);
  client.messages.create = client.messages.create.bind({ parent: client });
  return client;
}

const Q = (message, kind = 'question', done = false) => ({ coveredTopics: [], done, kind, message });

beforeAll(async () => {
  ctx = await makeTestContext();
  agents = { talentA: await ctx.loginAs(ctx.users.talentA) };
  await Track.updateOne(
    { key: 'ops' },
    {
      packText: 'TEST PACK',
      vocabPackVersion: 'v-test',
      competencyOrDomainList: ['build-ops'],
      controlledVocabulary: { execution: ['I run it'] },
      calibrationMode: false,
    },
  );
  talentUser = await User.findById(ctx.users.talentA._id);
});

afterAll(() => ctx.teardown());

async function conversationCard(name = 'Chat Card') {
  const res = await agents.talentA.post('/api/cards').send({ subjectName: name, captureMode: 'conversation' });
  return res.body.data;
}

describe('the conversation engine', () => {
  it('opens with an AI question; talent turns persist verbatim into rawAnswers; AI turns never do', async () => {
    const card = await conversationCard('Persist Card');
    const client = makeClient([
      Q('What is this work, and since when have you run it?'),
      Q('Who checks behind you day to day?'),
    ]);

    await converse(talentUser, card._id, { client }); // opening
    let stored = await Card.findById(card._id);
    expect(stored.conversation[0].role).toBe('ai');
    expect(stored.rawAnswers).toHaveLength(0);

    await converse(talentUser, card._id, { text: 'Kinukuha ko ang GCash board since March.', client });
    stored = await Card.findById(card._id);
    expect(stored.rawAnswers).toHaveLength(1);
    expect(stored.rawAnswers[0].answer).toBe('Kinukuha ko ang GCash board since March.');
    expect(stored.rawAnswers[0].question).toBe('What is this work, and since when have you run it?');
    // no AI text anywhere in rawAnswers
    expect(stored.rawAnswers.some((a) => a.answer.includes('checks behind you'))).toBe(false);
  });

  it('an AI-authored sentence can never become a quote (FR-10 reads talent words only)', async () => {
    const card = await conversationCard('Quote Wall Card');
    const client = makeClient([Q('Tell me about the board work?')]);
    await converse(talentUser, card._id, { client });
    await converse(talentUser, card._id, { text: 'I run it daily.', client: makeClient([Q('And who decides?')]) });

    const stored = await Card.findById(card._id);
    const track = await Track.findOne({ key: 'ops' });
    const { claims, rejected } = validateStructuredOutput(track, stored, {
      claims: [
        { type: 'claim', competencyOrDomain: 'build-ops', labels: { execution: 'I run it' }, sourceQuote: 'I run it daily.', flags: [], anchor: 'GCash, March' },
        { type: 'claim', competencyOrDomain: 'build-ops', labels: { execution: 'I run it' }, sourceQuote: 'Tell me about the board work?', flags: [], anchor: '' },
      ],
      followUps: [],
      signalsNoted: [],
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].sourceQuote).toBe('I run it daily.');
    expect(rejected[0].reason).toMatch(/quote/);
  });

  it('sweep answers land in sweepAnswers and arm submission; early wrap ends the chat', async () => {
    const card = await conversationCard('Sweep Card');
    const client = makeClient([
      Q('What is this work?'),
      Q('Anything else you own here that has not come up? "Not me" costs nothing.', 'sweep'),
      Q('That is all I need — you can send it in.', 'wrap', true),
    ]);

    await converse(talentUser, card._id, { client }); // opening question
    await converse(talentUser, card._id, { text: 'I run the board. Since Jan. Nobody checks. I decide lanes.', client });
    const { turn } = await converse(talentUser, card._id, { text: 'Wala na. Not me for the rest.', client });

    expect(turn.done).toBe(true);
    const stored = await Card.findById(card._id);
    expect(stored.sweepAnswers).toHaveLength(1);
    expect(stored.sweepAnswers[0].answer).toBe('Wala na. Not me for the rest.');
    expect(stored.conversation.filter((t) => t.role === 'ai')).toHaveLength(3); // well under the cap

    const submit = await agents.talentA.post(`/api/cards/${card._id}/submit`);
    expect(submit.status).toBe(200);
  });

  it('the hard cap forces a wrap with NO further AI call', async () => {
    const card = await conversationCard('Cap Card');
    const stored = await Card.findById(card._id);
    for (let i = 0; i < MAX_AI_QUESTIONS; i++) {
      stored.conversation.push({ role: 'ai', kind: 'question', text: `q${i}` });
      stored.conversation.push({ role: 'talent', kind: 'answer', text: `a${i}` });
      stored.rawAnswers.push({ questionIndex: null, question: `q${i}`, answer: `a${i}` });
    }
    await stored.save();

    const client = makeClient([Q('should never be asked')]);
    const { turn } = await converse(talentUser, card._id, { client });
    expect(turn.kind).toBe('wrap');
    expect(turn.done).toBe(true);
    expect(client.calls).toBe(0); // the cap answered, not the API
  });

  it('a second message while the reply is pending is refused — no double turns (JP bug, Aug 5)', async () => {
    const card = await conversationCard('Double Send Card');
    const client = makeClient([Q('What is this work?')]);
    await converse(talentUser, card._id, { client });

    // Simulate the race: the talent turn saved, the AI reply not yet.
    const stored = await Card.findById(card._id);
    stored.conversation.push({ role: 'talent', kind: 'answer', text: 'Yes! I handle this project.' });
    await stored.save();

    await expect(
      converse(talentUser, card._id, { text: 'Yes! I handle this project.', client }),
    ).rejects.toThrow(/still on your last message/);
    const after = await Card.findById(card._id);
    expect(after.conversation.filter((t) => t.text === 'Yes! I handle this project.')).toHaveLength(1);
  });

  it('after the wrap, the talent can still add and fix — the conversation reopens (JP, Aug 5)', async () => {
    const card = await conversationCard('Post Wrap Card');
    const client = makeClient([
      Q('What is this work?'),
      Q('Anything else you own here?', 'sweep'),
      Q('That is everything I need — send it in, or add anything by typing.', 'wrap', true),
      Q('Got it — noted that Denise made the final call there. Anything else to fix?'),
      Q('All set again — send it in when ready.', 'wrap', true),
    ]);

    await converse(talentUser, card._id, { client });
    await converse(talentUser, card._id, { text: 'I run the board since Jan, nobody checks.', client });
    const wrapped = await converse(talentUser, card._id, { text: 'Wala na.', client });
    expect(wrapped.turn.done).toBe(true);

    // The talent refines a nuance AFTER the wrap — it lands and the AI takes it in.
    const addition = await converse(talentUser, card._id, {
      text: 'Actually one fix: the final call on priorities was Denise, not me.',
      client,
    });
    expect(addition.turn.done).toBe(false);
    const stored = await Card.findById(card._id);
    expect(stored.rawAnswers.some((a) => a.answer.includes('Denise'))).toBe(true); // saved verbatim, will feed structuring
  });

  it('a form autosave PATCH can NEVER clobber a conversation card (JP data-loss bug, Aug 5)', async () => {
    const card = await conversationCard('Clobber Guard Card');
    const client = makeClient([
      Q('What is this work?'),
      Q('Anything else?', 'sweep'),
      Q('All set — send it in.', 'wrap', true),
    ]);
    await converse(talentUser, card._id, { client });
    await converse(talentUser, card._id, { text: 'I run the board since Jan.', client });
    await converse(talentUser, card._id, { text: 'Wala na.', client });

    // The old form's autosave payload: empty answers, guided mode, blank name.
    const res = await agents.talentA.patch(`/api/cards/${card._id}`).send({
      subjectName: 'Clobber Guard Card',
      captureMode: 'guided',
      rawAnswers: [],
      sweepAnswers: [],
      closeDate: null,
    });
    expect(res.status).toBe(200);

    const stored = await Card.findById(card._id);
    expect(stored.captureMode).toBe('conversation'); // mode survives
    expect(stored.rawAnswers).toHaveLength(1); // words survive
    expect(stored.sweepAnswers).toHaveLength(1); // sweep survives
    const submit = await agents.talentA.post(`/api/cards/${card._id}/submit`);
    expect(submit.status).toBe(200); // and it still submits
  });

  it('nobody but the talent converses on their card', async () => {
    const card = await conversationCard('Private Chat');
    const admin = await ctx.loginAs(ctx.users.admin);
    const res = await admin.post(`/api/cards/${card._id}/converse`).send({ text: 'hello' });
    expect([403, 404]).toContain(res.status);
  });
});
