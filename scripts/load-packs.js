/**
 * Pack loader — publishes a structuring prompt pack VERBATIM as an
 * immutable vocab_pack_version and points the track at it (Invariant 1).
 *
 * Usage:
 *   node scripts/load-packs.js <trackKey> <version> <packFile> <vocabFile>
 *
 *   trackKey   ops | artasset
 *   version    e.g. v0.4 (Ops) / v0.3 (A&A) — from the pack doc
 *   packFile   the canonical pack doc (e.g. docs/Olympus__Pack_Ops_v0.4.md)
 *   vocabFile  JSON sidecar: competencyOrDomainList, controlledVocabulary,
 *              and (v0.4+) claimFlags + packMode. Transcribe from the
 *              pack; do not invent entries.
 *
 * packMode "vocab-only" (A7): only the pack's §B (controlled vocabulary)
 * and §C (card schema) are ingested — §D/§E are JP-facing and never reach
 * the AI. Behavior is published separately (npm run load-behavior-spec).
 * Structuring for a vocab-only track WAITS until its behavior spec is
 * published.
 *
 * Attribution: the audit entry records JP's admin user (the person
 * running this command).
 */

import 'dotenv/config';
import fs from 'fs';
import { validateEnv } from '../src/config/envValidation.js';
import { connectMongo, disconnectMongo } from '../src/db/mongo.js';
import { Track } from '../src/models/Track.js';
import { User } from '../src/models/User.js';
import { VocabPackVersion } from '../src/models/VocabPackVersion.js';
import { recordAudit } from '../src/services/auditService.js';

const [trackKey, version, packFile, vocabFile] = process.argv.slice(2);
if (!trackKey || !version || !packFile || !vocabFile) {
  console.error('Usage: node scripts/load-packs.js <trackKey> <version> <packFile> <vocabFile>');
  process.exit(1);
}

validateEnv();
await connectMongo(process.env.MONGODB_URI);

/**
 * A7 consumption boundary: the AI reads §B and §C only — never §D
 * (JP's review checklist) or §E (correction log). Extracts from the
 * "## SECTION B" heading up to (excluding) "## SECTION D".
 */
function extractVocabSections(fullText) {
  const start = fullText.indexOf('## SECTION B');
  const end = fullText.indexOf('## SECTION D');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('vocab-only pack must contain "## SECTION B" … "## SECTION D" headings');
  }
  return fullText.slice(start, end).trim();
}

try {
  const rawPackText = fs.readFileSync(packFile, 'utf8');
  const vocab = JSON.parse(fs.readFileSync(vocabFile, 'utf8'));
  if (!Array.isArray(vocab.competencyOrDomainList) || vocab.competencyOrDomainList.length === 0) {
    throw new Error('vocabFile must define a non-empty competencyOrDomainList');
  }
  const packMode = vocab.packMode === 'vocab-only' ? 'vocab-only' : 'legacy';
  const packText = packMode === 'vocab-only' ? extractVocabSections(rawPackText) : rawPackText;

  const track = await Track.findOne({ key: trackKey });
  if (!track) throw new Error(`No such track: ${trackKey}`);

  const admin = await User.findOne({ email: 'jpdguzman@frostdesigngroup.com' });
  if (!admin) throw new Error('JP admin user not found — run npm run seed first');

  const pack = await VocabPackVersion.create({ trackKey, version, packText });

  const before = { vocabPackVersion: track.vocabPackVersion };
  track.vocabPackVersion = version;
  track.packText = packText;
  track.packMode = packMode;
  track.competencyOrDomainList = vocab.competencyOrDomainList;
  track.controlledVocabulary = vocab.controlledVocabulary ?? {};
  track.claimFlags = Array.isArray(vocab.claimFlags) ? vocab.claimFlags : [];
  track.boltIns = Array.isArray(vocab.parts?.part3BoltIns) ? vocab.parts.part3BoltIns : [];
  await track.save();

  await recordAudit({
    actorId: admin._id,
    action: 'track.pack-publish',
    entity: 'track',
    entityId: track._id,
    before,
    after: { vocabPackVersion: version, packId: pack._id, competencies: vocab.competencyOrDomainList.length },
  });

  console.log(`Published ${trackKey} pack ${version} (${packMode}): ${vocab.competencyOrDomainList.length} competencies/domains, ${Object.keys(track.controlledVocabulary).length} label fields, ${track.claimFlags.length} claim flags.`);
  if (packMode === 'vocab-only' && !track.behaviorSpecVersion) {
    console.log('NOTE: vocab-only pack — structuring WAITS until a behavior spec is published (npm run load-behavior-spec).');
  } else {
    console.log('Structuring for this track is now live — the worker picks up submitted drafts within 15s.');
  }
} finally {
  await disconnectMongo();
}
