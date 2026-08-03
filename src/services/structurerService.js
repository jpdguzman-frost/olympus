/**
 * Structurer — FR-7..FR-10.
 *
 * Calls the Anthropic API with the track's versioned vocabulary pack
 * (ported verbatim, stored on the track) plus the card's raw answers, and
 * parses drafted claims per the card schema.
 *
 * Invariants carried here:
 *  - 1: the pack is the vocabulary. The track's competencyOrDomainList and
 *       controlledVocabulary are loaded FROM the pack; nothing here invents
 *       a label. Structuring refuses to run until a pack is loaded.
 *  - 6: ambiguity defaults down — the pack's rules drive that; this layer
 *       never upgrades anything and drops what it cannot verify.
 *  - 9: every claim carries its source quote, and the quote must actually
 *       appear in the talent's raw words — fabricated quotes are rejected.
 *  - 10: AI never outputs levels. The JSON schema the model is forced to
 *       fill has no level/tier/texture/rank field to put one in, and the
 *       server-side validation layer (validateStructuredOutput) rejects
 *       any label value not in the track's controlled vocabulary,
 *       regardless of what the model returns.
 *  - NFR-4: the API key lives in server env; this module runs server-side
 *       only.
 *
 * FR-9: at most two clarification follow-ups per card, only for
 * unmappable input. The sweep is exempt (it happened at capture, FR-8).
 */

import Anthropic from '@anthropic-ai/sdk';
import { FLAG_VOCABULARY } from '../config/constants.js';

const MODEL = process.env.STRUCTURER_MODEL || 'claude-opus-5';
const MAX_FOLLOW_UPS = 2;

let defaultClient = null;
function getClient() {
  if (!defaultClient) defaultClient = new Anthropic();
  return defaultClient;
}

/** A track can structure only once its pack is loaded (Invariant 1). */
export function trackReadyForStructuring(track) {
  return Boolean(
    track?.packText &&
      track?.vocabPackVersion &&
      Array.isArray(track.competencyOrDomainList) &&
      track.competencyOrDomainList.length > 0,
  );
}

/**
 * The output schema the model is FORCED to follow (structured outputs).
 * Deliberately absent: any field for level, rung, tier, texture, rank,
 * readiness, promotion, or raise — there is nowhere to put one.
 */
export function buildOutputSchema(track) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['claims', 'followUps'],
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'competencyOrDomain', 'labels', 'sourceQuote', 'flags'],
          properties: {
            type: { type: 'string' },
            competencyOrDomain: { type: 'string', enum: track.competencyOrDomainList },
            labels: {
              type: 'object',
              additionalProperties: false,
              required: [],
              properties: Object.fromEntries(
                Object.entries(track.controlledVocabulary || {}).map(([field, values]) => [
                  field,
                  { type: 'string', enum: values },
                ]),
              ),
            },
            sourceQuote: { type: 'string' },
            involvement: { type: 'string' },
            countAfterMe: { type: 'integer' },
            flags: { type: 'array', items: { type: 'string', enum: FLAG_VOCABULARY } },
          },
        },
      },
      followUps: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };
}

function renderCardInput(card) {
  const answers = card.rawAnswers
    .map((a) =>
      a.questionIndex === null || a.questionIndex === undefined
        ? `SINGLE-PASS ANSWER:\n${a.answer}`
        : `Q${a.questionIndex + 1}: ${a.question}\nA${a.questionIndex + 1}: ${a.answer}`,
    )
    .join('\n\n');
  const sweeps = card.sweepAnswers
    .map((s) => `SWEEP PROMPT: ${s.prompt}\nSWEEP ANSWER: ${s.answer}`)
    .join('\n\n');
  return [
    `SUBJECT (${card.subject.kind}): ${card.subject.name}`,
    `CLOSE DATE: ${card.closeDate ? card.closeDate.toISOString().slice(0, 10) : 'not set'}`,
    '',
    'RAW ANSWERS (verbatim, any language):',
    answers,
    '',
    'COVERAGE SWEEP:',
    sweeps,
  ].join('\n');
}

/**
 * FR-7: pack + raw answers in, drafted claims out.
 * Throws StructuringError on refusal/AI failure — the caller leaves the
 * card in draft with raw intact (Invariant 15 / AC-8).
 */
export async function structureCard(track, card, { client = getClient() } = {}) {
  if (!trackReadyForStructuring(track)) {
    throw new StructuringError('awaiting-pack', `Track "${track.key}" has no vocabulary pack loaded`);
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: track.packText, // the calibrated pack, verbatim — reproduce, don't improve
    messages: [{ role: 'user', content: renderCardInput(card) }],
    output_config: { format: { type: 'json_schema', schema: buildOutputSchema(track) } },
  });

  if (response.stop_reason === 'refusal') {
    throw new StructuringError('refusal', 'The model declined to process this input');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new StructuringError('empty-response', 'No structured output returned');
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new StructuringError('parse-failure', `Structured output was not valid JSON: ${err.message}`);
  }

  return validateStructuredOutput(track, card, parsed);
}

export class StructuringError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * FR-10 — the server-side validation layer. Runs on every structuring
 * result AND on every talent claim edit (FR-12 re-validation). Fails
 * closed: anything off-vocabulary is dropped, never "fixed up".
 * Returns { claims, followUps, rejected } — rejected is audited.
 */
export function validateStructuredOutput(track, card, output) {
  const rejected = [];
  const allWords = normalize(
    [...card.rawAnswers.map((a) => a.answer), ...card.sweepAnswers.map((s) => s.answer)].join(' '),
  );
  const vocabulary = track.controlledVocabulary || {};
  const claims = [];

  for (const raw of Array.isArray(output.claims) ? output.claims : []) {
    // Invariant 7 (defensive): NOT-CLAIMED is not a claim. It maps to
    // nothing persisted — invisible to level reading, never a state.
    if ((raw.flags || []).includes('NOT-CLAIMED')) {
      rejected.push({ claim: raw, reason: 'NOT-CLAIMED maps to no persisted claim (Invariant 7)' });
      continue;
    }

    if (!track.competencyOrDomainList.includes(raw.competencyOrDomain)) {
      rejected.push({ claim: raw, reason: `Off-vocabulary competency/domain "${raw.competencyOrDomain}"` });
      continue;
    }

    // Invariant 9 + anti-fabrication: the quote must be the talent's words.
    const quote = normalize(raw.sourceQuote);
    if (!quote || !allWords.includes(quote)) {
      rejected.push({ claim: raw, reason: 'Source quote is missing or does not appear in the raw answers' });
      continue;
    }

    // Invariant 10: every label value must be in the controlled vocabulary.
    let labelsOk = true;
    for (const [field, value] of Object.entries(raw.labels || {})) {
      const allowed = vocabulary[field];
      if (!Array.isArray(allowed) || !allowed.includes(value)) {
        rejected.push({ claim: raw, reason: `Label ${field}="${value}" is not in the controlled vocabulary` });
        labelsOk = false;
        break;
      }
    }
    if (!labelsOk) continue;

    const flags = (raw.flags || []).filter((f) => FLAG_VOCABULARY.includes(f));

    claims.push({
      type: raw.type || 'claim',
      competencyOrDomain: raw.competencyOrDomain,
      labels: raw.labels || {},
      sourceQuote: raw.sourceQuote,
      involvement: raw.involvement ?? null,
      countAfterMe: Number.isInteger(raw.countAfterMe) ? raw.countAfterMe : null,
      flags,
      talentApproved: false,
      verdict: null,
    });
  }

  // FR-9: two clarification follow-ups per card, maximum. Excess is dropped.
  const followUps = (Array.isArray(output.followUps) ? output.followUps : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .slice(0, MAX_FOLLOW_UPS)
    .map((question) => ({ question, answer: null }));

  return { claims, followUps, rejected };
}
