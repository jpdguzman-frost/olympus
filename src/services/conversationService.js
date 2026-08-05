/**
 * B7 — the capture conversation (JP's spec, Aug 5).
 *
 * One question at a time, Socratic, adaptive. The four fixed questions
 * are the INVISIBLE skeleton: the AI covers their intent in its own
 * words, shaping each next question from the last answer. Voice:
 * English, approachable yet professional, simple words, no hype,
 * neutral.
 *
 * Shorter is better (JP): the moment the skeleton is covered, wrap —
 * the 12-question cap is latitude, never a target.
 *
 * Guardrails:
 *  - Invariant 15: every talent turn persists verbatim into rawAnswers
 *    the moment it arrives — before any AI call.
 *  - Talent-only quotes, structurally: AI turns never enter rawAnswers,
 *    and the FR-10 verbatim check reads rawAnswers only.
 *  - Invariant 10: the conversation never states a level, a reading, or
 *    a readiness opinion; its output schema has nowhere to put one.
 *  - The behavior spec (versioned data) is the policy; the frame below
 *    is mechanical plumbing. A conversation-mode addendum is drafted
 *    for JP to publish as v2.1 (GATE-1 verbatim-port rule applies).
 */

import Anthropic from '@anthropic-ai/sdk';
import { Card } from '../models/Card.js';
import { Track } from '../models/Track.js';
import { User } from '../models/User.js';
import { composeSystemPrompt, trackReadyForStructuring } from './structurerService.js';
import { taskScaffold } from './capsService.js';
import { badRequest, forbidden, notFound, conflict } from '../utils/httpError.js';
import { pushCardAudit } from './auditService.js';

const MODEL = process.env.STRUCTURER_MODEL || 'claude-opus-5';
export const MAX_AI_QUESTIONS = 12; // hard cap — latitude, never a target

export const SKELETON_TOPICS = [
  'work-and-since-when',
  'run-alone-vs-checked',
  'calls-made-and-by-whom',
  'what-broke-or-changed',
  'sweep',
];

let defaultClient = null;
function getClient() {
  if (!defaultClient) defaultClient = new Anthropic();
  return defaultClient;
}

function turnSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['coveredTopics', 'done', 'kind', 'message'],
    properties: {
      // Which skeleton intents the talent's answers so far already cover.
      coveredTopics: { type: 'array', items: { type: 'string', enum: SKELETON_TOPICS } },
      done: { type: 'boolean' },
      kind: { type: 'string', enum: ['question', 'sweep', 'wrap'] },
      message: { type: 'string' },
    },
  };
}

function renderConversationInput(card, capsScaffold, summary, aiQuestionsUsed) {
  const parts = [
    `SUBJECT (${card.subject.kind}): ${card.subject.name || 'not named yet'}`,
    `CLOSE DATE: ${card.closeDate ? card.closeDate.toISOString().slice(0, 10) : 'not set'}`,
  ];
  if (summary) {
    parts.push('', 'ACTIVITY SUMMARY (from CAPS — memory scaffold, never evidence):', summary);
  } else if (capsScaffold?.tasks?.length) {
    parts.push(
      '',
      'CAPS MEMORY SCAFFOLD (context only — NEVER evidence):',
      ...capsScaffold.tasks.slice(0, 40).map(
        (t) => `- ${t.date ? t.date.toISOString().slice(0, 10) : ''} · ${t.category ?? ''} · ${t.taskName}`,
      ),
    );
  }
  parts.push('', 'THE CONVERSATION SO FAR:');
  if (!card.conversation.length) parts.push('(none — you open it)');
  for (const turn of card.conversation) {
    parts.push(`${turn.role === 'ai' ? 'YOU' : 'TALENT'}: ${turn.text}`);
  }
  parts.push(
    '',
    'YOUR TASK — the capture conversation (mechanical frame; your rules govern the substance):',
    'You are running the talent-facing capture as a conversation, ONE message at a time.',
    'The four fixed questions are your invisible skeleton — cover their INTENT, never read them out:',
    '  1. what work this is and since when (the anchor: account + dates)',
    '  2. what they run themselves day to day vs what someone still checks behind them',
    '  3. what calls they made alone, and who made the other calls (never round up)',
    '  4. what broke or changed, and what they did',
    'Ask in your own words. Shape each next question from their last answer. If an answer already',
    'covers a topic, do not ask it again — SHORTER IS BETTER; wrap as soon as the skeleton is covered.',
    'Nudge gently toward what the model needs: dates and account, the call-owner, and the three',
    'upgrade elements (moment, alternative, trace) when something reads above its anchor.',
    'Stay within your question budget. Never state a level, a score, or a reading. Never interrogate;',
    'a vague answer is noted, not chased past your budget.',
    `You have used ${aiQuestionsUsed} of ${MAX_AI_QUESTIONS} questions (a ceiling, not a goal).`,
    'When the skeleton is covered (or the budget is spent), kind="sweep": ONE compact message asking',
    'what else they own here that has not come up — remind them "not me" costs nothing, and that a',
    'yes needs one detail (what, where, since when). After their sweep answer (with one detail invite',
    'if they said yes to something bare), kind="wrap": tell them plainly you have what you need and',
    'they can send it in. Set done=true only on the wrap.',
    'VOICE: English. Approachable yet professional. Simple words. No hype. Neutral.',
    'Output only the schema.',
  );
  return parts.join('\n');
}

/**
 * One engine turn: the talent's message (if any) is ALREADY persisted by
 * the caller; this produces the AI's next message.
 */
export async function nextTurn(track, card, { client = getClient(), capsScaffold = null, summary = null } = {}) {
  const aiQuestionsUsed = card.conversation.filter((t) => t.role === 'ai').length;

  // The hard cap: never an endless interview. Force the wrap.
  if (aiQuestionsUsed >= MAX_AI_QUESTIONS) {
    return {
      kind: 'wrap',
      done: true,
      coveredTopics: SKELETON_TOPICS,
      message:
        "That's plenty — thank you. I have what I need from what you've shared. Anything thin stays as a draft you can add to later. You can send it in now.",
    };
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: composeSystemPrompt(track),
    messages: [{ role: 'user', content: renderConversationInput(card, capsScaffold, summary, aiQuestionsUsed) }],
    output_config: { format: { type: 'json_schema', schema: turnSchema() } },
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No conversation turn returned');
  return JSON.parse(textBlock.text);
}

/**
 * The talent speaks (or opens the card): persist their words FIRST
 * (Invariant 15), then get the AI's next message.
 */
export async function converse(actor, cardId, { text = null, client = null } = {}) {
  const card = await Card.findById(cardId);
  if (!card) throw notFound('Card not found');
  if (!card.talentId.equals(actor._id)) throw forbidden('Only the card\'s talent can talk on their card');
  if (!actor.hasRole('talent')) throw forbidden('Talent role required');
  if (card.status !== 'draft') throw conflict(`The conversation is over — the card moved on (status "${card.status}")`);

  const track = await Track.findOne({ key: card.track });
  if (!track || !trackReadyForStructuring(track)) {
    throw conflict('The capture assistant is not ready on this track yet — ask JP');
  }

  const lastAi = [...card.conversation].reverse().find((t) => t.role === 'ai');

  if (text?.trim()) {
    const clean = String(text).trim();
    // Invariant 15: the talent's words persist BEFORE any AI call.
    card.conversation.push({ role: 'talent', kind: 'answer', text: clean });
    if (lastAi?.kind === 'sweep') {
      card.sweepAnswers.push({ prompt: lastAi.text, answer: clean });
    } else {
      card.rawAnswers.push({ questionIndex: null, question: lastAi?.text ?? 'opening', answer: clean });
    }
    await card.save();
  } else if (card.conversation.length && lastAi && lastAi === card.conversation[card.conversation.length - 1]) {
    // No new text and the AI already spoke last — return the standing question.
    return { card, turn: { kind: lastAi.kind, message: lastAi.text, done: false } };
  }

  const talent = await User.findById(card.talentId);
  const capsScaffold = await taskScaffold(talent?.capsName, card.subject.name).catch(() => null);
  const { cachedSummary } = await import('./summaryService.js');
  const summary = await cachedSummary(talent, card.subject.name).catch(() => null);

  const turn = await nextTurn(track, card, { ...(client ? { client } : {}), capsScaffold, summary: summary?.text ?? null });

  card.conversation.push({ role: 'ai', kind: turn.kind, text: turn.message });
  pushCardAudit(card, { by: actor._id, action: 'conversation-turn', note: turn.kind });
  await card.save();

  return { card, turn };
}
