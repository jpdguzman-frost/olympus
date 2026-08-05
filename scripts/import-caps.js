/**
 * CAPS CSV import — the A2 hard wall lives HERE, at the boundary.
 *
 * Usage:
 *   node scripts/import-caps.js <csvFile>
 *
 * Whitelist ingestion, not blocklist: only the named columns below are
 * read. Task/Contribution Weight, Final Score, Difficulty, the numeric
 * review-score twins, credit fractions, Accepted/Discarded, Tags —
 * none of it is read past the header. The batch record names what was
 * dropped, for the audit trail.
 *
 * Each import replaces the previous batch's rows (versioned batch
 * history kept). The canonical alias rules from the caps-analysis
 * model apply to the contributor AND every reviewer column.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateEnv } from '../src/config/envValidation.js';
import { connectMongo, disconnectMongo } from '../src/db/mongo.js';
import { CapsTaskRow, CapsImportBatch } from '../src/models/CapsTaskRow.js';
import { User } from '../src/models/User.js';
import { recordAudit } from '../src/services/auditService.js';

const [csvFile] = process.argv.slice(2);

// The ONLY columns the app may read (A2). First occurrence wins — the
// sheet repeats review-column names later as numeric score twins.
const WHITELIST = {
  taskName: 'Task name',
  projectName: 'Project Name',
  contributorName: 'Contributor',
  category: 'Category',
  date: 'Date',
  week: 'Week',
};
const REVIEWER_COLUMNS = [
  'Peer Review', 'Design Review', 'Content Peer Review', 'Content Review',
  'Content Checks', 'Dev Peer Review', 'Code Review', 'Ops Review',
  'QA Validation', 'Design QA',
];

// Canonical identity aliases (caps-analysis pipeline §3).
const ALIASES = {
  'Roni Angelie Inocencio': 'August Inocencio',
  'Yelle Venzon': 'Erielle Venzon',
  'frost-dev': 'Frost Dev Team',
};
const alias = (name) => ALIASES[name] ?? name;

/** Minimal RFC-4180 CSV parser: quotes, escaped quotes, newlines in quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function extractRows(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0];

  const firstIndexOf = (name) => header.indexOf(name); // first occurrence wins
  const cols = Object.fromEntries(Object.entries(WHITELIST).map(([key, name]) => [key, firstIndexOf(name)]));
  for (const [key, idx] of Object.entries(cols)) {
    if (idx === -1) throw new Error(`CSV is missing required column for ${key}`);
  }
  const reviewerCols = REVIEWER_COLUMNS
    .map((name) => ({ name, idx: firstIndexOf(name) }))
    .filter((c) => c.idx !== -1);

  const readIndexes = new Set([...Object.values(cols), ...reviewerCols.map((c) => c.idx)]);
  const droppedColumns = [...new Set(header.filter((_, i) => !readIndexes.has(i)))].filter(Boolean);

  const out = [];
  for (const r of rows.slice(1)) {
    const contributorName = alias((r[cols.contributorName] || '').trim());
    const projectName = (r[cols.projectName] || '').trim();
    const taskName = (r[cols.taskName] || '').trim();
    if (!contributorName || !projectName || !taskName) continue;

    const reviewers = [];
    for (const { name, idx } of reviewerCols) {
      const value = (r[idx] || '').trim();
      if (value && value !== '-' && value !== '0') reviewers.push({ type: name, name: alias(value) });
    }

    const dateRaw = (r[cols.date] || '').trim(); // M/D/YYYY
    let date = null;
    const m = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) date = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
    const week = Number.parseInt(r[cols.week], 10);

    out.push({
      taskName,
      projectName,
      contributorName,
      category: (r[cols.category] || '').trim() || null,
      reviewers,
      date,
      week: Number.isInteger(week) ? week : null,
    });
  }
  return { rows: out, droppedColumns };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!csvFile) {
    console.error('Usage: node scripts/import-caps.js <csvFile>');
    process.exit(1);
  }
  validateEnv();
  await connectMongo(process.env.MONGODB_URI);
  try {
    const { rows, droppedColumns } = extractRows(fs.readFileSync(csvFile, 'utf8'));
    const dates = rows.map((r) => r.date).filter(Boolean).sort((a, b) => a - b);
    const batchId = `caps-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;

    await CapsTaskRow.deleteMany({}); // the mirror holds ONE batch; history in caps_import_batches
    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      await CapsTaskRow.insertMany(rows.slice(i, i + BATCH).map((r) => ({ ...r, batchId })));
    }
    await CapsImportBatch.create({
      batchId,
      source: path.basename(csvFile),
      rowCount: rows.length,
      droppedColumns,
      windowStart: dates[0] ?? null,
      windowEnd: dates[dates.length - 1] ?? null,
    });

    const admin = await User.findOne({ email: 'jpdguzman@frostdesigngroup.com' });
    await recordAudit({
      actorId: admin?._id ?? null,
      action: 'caps.import',
      entity: 'caps-batch',
      entityId: null,
      after: { batchId, rows: rows.length, dropped: droppedColumns.length, source: path.basename(csvFile) },
    });

    console.log(`Imported ${rows.length} CAPS rows as ${batchId}.`);
    console.log(`Window: ${dates[0]?.toISOString().slice(0, 10)} → ${dates[dates.length - 1]?.toISOString().slice(0, 10)}`);
    console.log(`Dropped at the wall (${droppedColumns.length} columns): ${droppedColumns.join(' · ')}`);
  } finally {
    await disconnectMongo();
  }
}
