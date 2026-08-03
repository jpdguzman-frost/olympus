/**
 * Pack loader — publishes a structuring prompt pack VERBATIM as an
 * immutable vocab_pack_version and points the track at it (Invariant 1).
 *
 * Usage:
 *   node scripts/load-packs.js <trackKey> <version> <packFile> <vocabFile>
 *
 *   trackKey   ops | artasset
 *   version    e.g. v0.2 (Ops) / v0.3 (A&A) — from the pack doc
 *   packFile   e.g. docs/phase1-structuring-prompt-v0.2-ops.md (ported verbatim)
 *   vocabFile  JSON: {
 *                "competencyOrDomainList": ["...", ...],
 *                "controlledVocabulary": { "<labelField>": ["allowed", ...] }
 *              }
 *              — the machine-readable side of the pack the FR-10 layer
 *              validates against. Transcribe it from the pack; do not
 *              invent entries.
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

try {
  const packText = fs.readFileSync(packFile, 'utf8');
  const vocab = JSON.parse(fs.readFileSync(vocabFile, 'utf8'));
  if (!Array.isArray(vocab.competencyOrDomainList) || vocab.competencyOrDomainList.length === 0) {
    throw new Error('vocabFile must define a non-empty competencyOrDomainList');
  }

  const track = await Track.findOne({ key: trackKey });
  if (!track) throw new Error(`No such track: ${trackKey}`);

  const admin = await User.findOne({ email: 'jpdguzman@frostdesigngroup.com' });
  if (!admin) throw new Error('JP admin user not found — run npm run seed first');

  const pack = await VocabPackVersion.create({ trackKey, version, packText });

  const before = { vocabPackVersion: track.vocabPackVersion };
  track.vocabPackVersion = version;
  track.packText = packText;
  track.competencyOrDomainList = vocab.competencyOrDomainList;
  track.controlledVocabulary = vocab.controlledVocabulary ?? {};
  await track.save();

  await recordAudit({
    actorId: admin._id,
    action: 'track.pack-publish',
    entity: 'track',
    entityId: track._id,
    before,
    after: { vocabPackVersion: version, packId: pack._id, competencies: vocab.competencyOrDomainList.length },
  });

  console.log(`Published ${trackKey} pack ${version}: ${vocab.competencyOrDomainList.length} competencies/domains, ${Object.keys(track.controlledVocabulary).length} label fields.`);
  console.log('Structuring for this track is now live — the worker picks up submitted drafts within 15s.');
} finally {
  await disconnectMongo();
}
