/**
 * CAPS reads (Amendment 1 §A2) — everything the app is allowed to know
 * from CAPS, and nothing else. All queries run against the whitelist
 * mirror (CapsTaskRow); the banned data never entered the building.
 *
 *  - Exposure auto-verify: the nominee's name in a reviewer column on
 *    the talent's rows for that project, across 3+ DISTINCT weeks.
 *    Weeks of exposure, never count-as-authority.
 *  - Project tenure: first → last task date per (person, project) —
 *    the leadership-weeks hold (JP, Aug 5) replaced weeks_led with
 *    this, derived from already-whitelisted dates.
 *  - Memory scaffold: task names/categories/dates for capture and
 *    structuring context. Context, never evidence, never a pre-fill.
 *  - Catch-up door: the talent's CAPS projects with no card yet.
 *
 * No CAPS data → every caller degrades to its fallback. CAPS is an
 * accelerator, never a gate.
 */

import { CapsTaskRow, CapsImportBatch } from '../models/CapsTaskRow.js';
import { Card } from '../models/Card.js';
import { EXPOSURE_AUTO_VERIFY_WEEKS } from '../config/constants.js';

/** Latest import batch metadata, or null when CAPS has never loaded. */
export function currentBatch() {
  return CapsImportBatch.findOne().sort({ createdAt: -1 });
}

/**
 * A1: auto-verify exposure — distinct weeks in which the nominee
 * reviewed the talent's work on this project. Returns { weeks,
 * verified } — verified only at 3+ (threshold tunable post-pilot).
 */
export async function reviewExposure(talentCapsName, nomineeCapsName, projectName) {
  if (!talentCapsName || !nomineeCapsName || !projectName) return { weeks: 0, verified: false };
  const rows = await CapsTaskRow.find(
    { contributorName: talentCapsName, projectName, 'reviewers.name': nomineeCapsName },
    { week: 1 },
  );
  const weeks = new Set(rows.map((r) => r.week).filter((w) => w !== null)).size;
  return { weeks, verified: weeks >= EXPOSURE_AUTO_VERIFY_WEEKS };
}

/** Project tenure: first → last task date for this person on this project. */
export async function tenureFor(capsName, projectName) {
  if (!capsName || !projectName) return null;
  const rows = await CapsTaskRow.find({ contributorName: capsName, projectName }, { date: 1 }).sort({ date: 1 });
  const dates = rows.map((r) => r.date).filter(Boolean);
  if (!dates.length) return null;
  return { from: dates[0], to: dates[dates.length - 1] };
}

/**
 * Memory scaffold for capture/structuring: the talent's own tasks on
 * this project — names, categories, dates. NOTHING here is evidence;
 * the talent's words are the only evidence.
 */
export async function taskScaffold(capsName, projectName, { limit = 60 } = {}) {
  if (!capsName || !projectName) return null;
  const rows = await CapsTaskRow.find(
    { contributorName: capsName, projectName },
    { taskName: 1, category: 1, date: 1 },
  )
    .sort({ date: 1 })
    .limit(limit);
  if (!rows.length) return null;
  const tenure = await tenureFor(capsName, projectName);
  return {
    projectName,
    tenure,
    tasks: rows.map((r) => ({ taskName: r.taskName, category: r.category, date: r.date })),
  };
}

/**
 * Door 2 "Catch up": the talent's CAPS projects with no card yet, in a
 * date range. Range-pull is navigation, never a capture mode. Tenure
 * shown; NO task counts (a count is a volume statistic).
 */
export async function catchUpProjects(talentUser, { from = null, to = null } = {}) {
  if (!talentUser.capsName) return [];
  const query = { contributorName: talentUser.capsName };
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = new Date(from);
    if (to) query.date.$lte = new Date(to);
  }
  const projects = await CapsTaskRow.distinct('projectName', query);
  if (!projects.length) return [];

  const carded = await Card.distinct('subject.name', { talentId: talentUser._id });
  const cardedSet = new Set(carded);

  const result = [];
  for (const projectName of projects.sort()) {
    if (cardedSet.has(projectName)) continue;
    result.push({ projectName, tenure: await tenureFor(talentUser.capsName, projectName) });
  }
  return result;
}
