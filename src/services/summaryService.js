/**
 * B7 — the project activity summary (JP's spec point 2).
 *
 * From the CAPS scaffold only: a short, neutral picture of what the
 * talent did on the project — an opening line or two plus activities
 * grouped by kind, with task names and the time span. The card name IS
 * the work (JP): no links, no descriptions, and NEVER a count or total
 * (volume is a banned statistic, A2).
 *
 * Cached per (capsName, project, batch); regenerates when a new CAPS
 * import lands. It shows to the talent for clarity and feeds the
 * capture conversation as context. Memory, never evidence.
 */

import mongoose from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import { taskScaffold, currentBatch } from './capsService.js';

// JP (Aug 5): summaries/categorization run on Sonnet 5; structuring stays on Opus.
const MODEL = process.env.CONVERSATION_MODEL || 'claude-sonnet-5';

const capsSummarySchema = new mongoose.Schema(
  {
    capsName: { type: String, required: true },
    projectName: { type: String, required: true },
    batchId: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
capsSummarySchema.index({ capsName: 1, projectName: 1, batchId: 1 }, { unique: true });
export const CapsSummary = mongoose.model('CapsSummary', capsSummarySchema, 'caps_summaries');

let defaultClient = null;
function getClient() {
  if (!defaultClient) defaultClient = new Anthropic();
  return defaultClient;
}

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: { type: 'string' } },
};

export async function cachedSummary(talentUser, projectName, { client = getClient() } = {}) {
  if (!talentUser?.capsName || !projectName) return null;
  const batch = await currentBatch();
  if (!batch) return null;

  const hit = await CapsSummary.findOne({ capsName: talentUser.capsName, projectName, batchId: batch.batchId });
  if (hit) return hit;

  const scaffold = await taskScaffold(talentUser.capsName, projectName, { limit: 120 });
  if (!scaffold) return null;

  const content = [
    `Project: ${projectName}`,
    `Tenure: ${scaffold.tenure ? `${scaffold.tenure.from?.toISOString().slice(0, 10)} to ${scaffold.tenure.to?.toISOString().slice(0, 10)}` : 'unknown'}`,
    'Task records (name · kind · date) — the card name IS the work; there is nothing behind it:',
    ...scaffold.tasks.map((t) => `- ${t.taskName} · ${t.category ?? ''} · ${t.date ? t.date.toISOString().slice(0, 10) : ''}`),
    '',
    'Write a short activity summary for the person who did this work, so they can see at a glance',
    'what they did on this project before filing their card. Group the work by kind, name the',
    'representative tasks, and state the time span.',
    'HARD RULES: never a number of tasks, never a total, never any volume statement ("many", "47", "high output").',
    'Never a judgment, level, score, or praise. No links. Neutral, simple English; short.',
    'FORMAT — built to scan, never a wall of text (JP, Aug 6):',
    '- One opening line, under 12 words.',
    '- Then 3 to 6 lines, each starting with "• ", each under 14 words:',
    '  "• Board upkeep — cards like X and Y · Jan–Jun 2026"',
    '- Nothing else. No paragraph anywhere.',
  ].join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system:
      'You summarize a work record plainly. Approachable yet professional, simple words, no hype, neutral. You never evaluate, never count, never rank.',
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: SUMMARY_SCHEMA } },
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  const { summary } = JSON.parse(textBlock.text);

  return CapsSummary.findOneAndUpdate(
    { capsName: talentUser.capsName, projectName, batchId: batch.batchId },
    { $setOnInsert: { text: summary } },
    { upsert: true, new: true },
  );
}
