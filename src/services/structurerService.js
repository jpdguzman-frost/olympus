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

/**
 * A track can structure only once its pack is loaded (Invariant 1) — and,
 * in split mode (packMode 'vocab-only', A7), only once a behavior spec is
 * published too: a vocab-only pack has no behavior in it, so structuring
 * with the pack alone would run rule-less. Fails closed.
 */
export function trackReadyForStructuring(track) {
  const packReady = Boolean(
    track?.packText &&
      track?.vocabPackVersion &&
      Array.isArray(track.competencyOrDomainList) &&
      track.competencyOrDomainList.length > 0,
  );
  if (!packReady) return false;
  if (track.packMode === 'vocab-only') {
    return Boolean(track.behaviorSpecVersion && track.behaviorSpecText);
  }
  return true;
}

/**
 * Ruling C6: two flag layers. The AI may only output the pack's
 * claim-level flags (§B8, stored on the track); tracks without a
 * claim-flag list (legacy packs) keep the original FLAG_VOCABULARY.
 * Card/system-level flags (STALE, THIN-POOL, …) are attached by the
 * server, never by the AI.
 */
export function trackClaimFlags(track) {
  return Array.isArray(track?.claimFlags) && track.claimFlags.length > 0
    ? track.claimFlags
    : FLAG_VOCABULARY;
}

/**
 * The system prompt. Split mode (A7): behavior spec (versioned data,
 * never hard-coded) + the vocab pack's §B/§C. Legacy: the pack verbatim.
 */
export function composeSystemPrompt(track) {
  if (track.packMode === 'vocab-only') {
    return [
      track.behaviorSpecText,
      '\n---\n',
      'CONTROLLED VOCABULARY AND CARD SCHEMA (closed lists — the only words and shape you may output):',
      track.packText,
    ].join('\n');
  }
  return track.packText; // the calibrated pack, verbatim — reproduce, don't improve
}

/**
 * The output schema the model is FORCED to follow (structured outputs).
 * Deliberately absent: any field for level, rung, tier, texture, rank,
 * readiness, promotion, or raise — there is nowhere to put one.
 */
function claimItemSchema(track) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'competencyOrDomain', 'labels', 'sourceQuote', 'flags', 'anchor'],
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
      flags: { type: 'array', items: { type: 'string', enum: trackClaimFlags(track) } },
      // A4 date anchoring: account + date/period IN THE TALENT'S WORDS,
      // empty string when they never said one. Never invented.
      anchor: { type: 'string' },
    },
  };
}

export function buildOutputSchema(track) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['claims', 'followUps', 'signalsNoted'],
    properties: {
      claims: {
        type: 'array',
        items: claimItemSchema(track),
      },
      followUps: {
        type: 'array',
        items: { type: 'string' },
      },
      // A4: upward signals present in the words but not claimed —
      // recorded with their verbatim quote, never as a claim.
      signalsNoted: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['signal', 'sourceQuote'],
          properties: {
            signal: { type: 'string' },
            sourceQuote: { type: 'string' },
          },
        },
      },
    },
  };
}

function renderCardInput(card, capsScaffold = null) {
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
  const parts = [
    `SUBJECT (${card.subject.kind}): ${card.subject.name}`,
    `CLOSE DATE: ${card.closeDate ? card.closeDate.toISOString().slice(0, 10) : 'not set'}`,
    '',
    'RAW ANSWERS (verbatim, any language):',
    answers,
    '',
    'COVERAGE SWEEP:',
    sweeps,
  ];
  // A2/A3: the CAPS memory scaffold — whitelisted task names, categories
  // and dates ONLY. It is context and a date source, NEVER evidence:
  // claims come from the talent's words alone, and quotes must be theirs.
  if (capsScaffold?.tasks?.length) {
    parts.push(
      '',
      'CAPS MEMORY SCAFFOLD (context only — NEVER evidence; no value data exists here):',
      `Project tenure per CAPS: ${capsScaffold.tenure ? `${capsScaffold.tenure.from?.toISOString().slice(0, 10)} to ${capsScaffold.tenure.to?.toISOString().slice(0, 10)}` : 'unknown'}`,
      ...capsScaffold.tasks.map(
        (t) => `- ${t.date ? t.date.toISOString().slice(0, 10) : 'undated'} · ${t.category ?? 'uncategorized'} · ${t.taskName}`,
      ),
    );
  }

  // Mechanical task frame — PLUMBING, not behavior (the behavior spec is
  // versioned data and stays verbatim). The spec is written for a live
  // back-and-forth; this tells the model it is the one-shot structuring
  // step of that same pipeline. Flagged to JP for a possible one-shot
  // section in the spec at GATE-1.
  parts.push(
    '',
    'THE TASK, NOW: you are the structuring step of the pipeline your rules describe.',
    'This is a FILED card, not a live chat — the talent is not present to answer you here.',
    'The capture already happened: the plain four questions above WERE asked and answered.',
    'If no CAPS scaffold appears above, that only means no scaffold exists — the answers are still the complete input. Structure them.',
    'In one pass, apply your rules to the raw answers above:',
    '- Draft EVERY claim their words support, each at the lowest plausible reading, controlled vocabulary only.',
    '- Every claim carries its traceback: sourceQuote must be an EXACT verbatim substring of their answers.',
    '- anchor: the account + date/period IN THEIR WORDS (empty string if they never said one).',
    '- Note upward signals they did not claim (signalsNoted), each with its exact verbatim quote.',
    '- followUps: the anchor/clarifier questions you would ask, within your question budget — they will be relayed to the talent.',
    'Output only the schema. Never a level, never a score.',
  );
  return parts.join('\n');
}

/**
 * FR-7: pack + raw answers in, drafted claims out.
 * Throws StructuringError on refusal/AI failure — the caller leaves the
 * card in draft with raw intact (Invariant 15 / AC-8).
 */
export async function structureCard(track, card, { client = getClient(), capsScaffold = null } = {}) {
  if (!trackReadyForStructuring(track)) {
    throw new StructuringError('awaiting-pack', `Track "${track.key}" has no vocabulary pack loaded`);
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: composeSystemPrompt(track),
    messages: [{ role: 'user', content: renderCardInput(card, capsScaffold) }],
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

    const allowedFlags = trackClaimFlags(track);
    const flags = (raw.flags || []).filter((f) => allowedFlags.includes(f));

    // A4 anchor: kept only when the model actually extracted one from
    // the talent's words; an empty anchor leaves the line "needs a date".
    const anchorText = typeof raw.anchor === 'string' && raw.anchor.trim() ? raw.anchor.trim() : null;

    claims.push({
      type: raw.type || 'claim',
      competencyOrDomain: raw.competencyOrDomain,
      labels: raw.labels || {},
      sourceQuote: raw.sourceQuote,
      involvement: raw.involvement ?? null,
      countAfterMe: Number.isInteger(raw.countAfterMe) ? raw.countAfterMe : null,
      flags,
      anchorText,
      anchorSource: anchorText ? 'structurer' : null,
      talentApproved: false,
      verdict: null,
    });
  }

  // A4 signals noted, not claimed: same anti-fabrication bar as claims —
  // the quote must be the talent's verbatim words or the signal drops.
  const signalsNoted = [];
  for (const raw of Array.isArray(output.signalsNoted) ? output.signalsNoted : []) {
    const quote = normalize(raw.sourceQuote);
    if (!raw.signal?.trim() || !quote || !allWords.includes(quote)) {
      rejected.push({ claim: raw, reason: 'Signal quote is missing or does not appear in the raw answers' });
      continue;
    }
    signalsNoted.push({ signal: raw.signal.trim(), sourceQuote: raw.sourceQuote, at: new Date() });
  }

  // A3 question budget (supersedes FR-9's per-card cap): 1 anchor + max
  // 2 clarifiers PER TOUCHED ROW. Enforced server-side as a ceiling of
  // 3 x drafted rows (floor of 2 for the no-CAPS four-question path).
  // Budget spent -> the row stays "insufficient detail - draft".
  const followUpCap = Math.max(MAX_FOLLOW_UPS, 3 * claims.length);
  const followUps = (Array.isArray(output.followUps) ? output.followUps : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .slice(0, followUpCap)
    .map((question) => ({ question, answer: null }));

  return { claims, followUps, signalsNoted, rejected };
}

// ---------------------------------------------------------------------------
// A4 contention loop — single-line re-map
// ---------------------------------------------------------------------------

/**
 * The talent contested a line against its traceback. The model re-reads
 * the objection and either re-maps the line or explains why the mapping
 * stands. A re-map runs back through the FR-10 layer — it can never
 * inflate past the vocabulary; a rejected re-map becomes an explanation.
 * Returns { outcome: 'remapped'|'explained', claim|null, explanation }.
 */
export async function remapClaim(track, card, claim, contentionText, { client = getClient() } = {}) {
  if (!trackReadyForStructuring(track)) {
    throw new StructuringError('awaiting-pack', `Track "${track.key}" is not ready`);
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['remapped', 'claim', 'explanation'],
    properties: {
      remapped: { type: 'boolean' },
      claim: claimItemSchema(track),
      explanation: { type: 'string' },
    },
  };

  const userContent = [
    renderCardInput(card),
    '',
    'CONTESTED LINE (currently drafted):',
    JSON.stringify({
      competencyOrDomain: claim.competencyOrDomain,
      labels: claim.labels,
      sourceQuote: claim.sourceQuote,
      anchor: claim.anchorText,
      flags: claim.flags,
    }),
    '',
    `THE TALENT CONTESTS THIS MAPPING (verbatim): ${contentionText}`,
    '',
    'Re-read the objection against the traceback quote and the raw answers.',
    'If the mapping should change, set remapped=true and output the corrected line.',
    'If the mapping stands, set remapped=false and explain why in plain, simple words.',
    'All your rules still apply: only the controlled vocabulary, ambiguity defaults down, never inflate.',
  ].join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: composeSystemPrompt(track),
    messages: [{ role: 'user', content: userContent }],
    output_config: { format: { type: 'json_schema', schema } },
  });

  if (response.stop_reason === 'refusal') {
    throw new StructuringError('refusal', 'The model declined to process this contention');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new StructuringError('empty-response', 'No re-map output returned');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new StructuringError('parse-failure', `Re-map output was not valid JSON: ${err.message}`);
  }

  if (!parsed.remapped) {
    return { outcome: 'explained', claim: null, explanation: parsed.explanation || 'The mapping stands.' };
  }

  // Invariant 6/10: the re-map faces the same wall the original did.
  const { claims, rejected } = validateStructuredOutput(track, card, {
    claims: [parsed.claim],
    followUps: [],
    signalsNoted: [],
  });
  if (!claims.length) {
    return {
      outcome: 'explained',
      claim: null,
      explanation: `The re-map could not stand: ${rejected[0]?.reason ?? 'validation failed'}. The line stays as it was.`,
    };
  }
  return { outcome: 'remapped', claim: claims[0], explanation: parsed.explanation || '' };
}
