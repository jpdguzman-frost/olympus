/**
 * Behavior spec loader — publishes the AI capture/structuring behavior
 * (Intent v2) as an immutable behavior_spec_version and points the track
 * at it (Amendment 1 §A7: versioned data, never hard-coded; CALIBRATING
 * until the verbatim GATE-1 port is republished).
 *
 * Usage:
 *   node scripts/load-behavior-spec.js <trackKey> <version> <specFile>
 *
 *   trackKey  ops | artasset
 *   version   e.g. v2-calibrating (pre-GATE-1) / v2 (the GATE-1 port)
 *   specFile  e.g. docs/Olympus__M0_Intent_v2.md
 *
 * Attribution: the audit entry records JP's admin user.
 */

import 'dotenv/config';
import fs from 'fs';
import { validateEnv } from '../src/config/envValidation.js';
import { connectMongo, disconnectMongo } from '../src/db/mongo.js';
import { Track } from '../src/models/Track.js';
import { User } from '../src/models/User.js';
import { BehaviorSpecVersion } from '../src/models/BehaviorSpecVersion.js';
import { recordAudit } from '../src/services/auditService.js';

const [trackKey, version, specFile] = process.argv.slice(2);
if (!trackKey || !version || !specFile) {
  console.error('Usage: node scripts/load-behavior-spec.js <trackKey> <version> <specFile>');
  process.exit(1);
}

validateEnv();
await connectMongo(process.env.MONGODB_URI);

try {
  const text = fs.readFileSync(specFile, 'utf8');

  const track = await Track.findOne({ key: trackKey });
  if (!track) throw new Error(`No such track: ${trackKey}`);

  const admin = await User.findOne({ email: 'jpdguzman@frostdesigngroup.com' });
  if (!admin) throw new Error('JP admin user not found — run npm run seed first');

  const spec = await BehaviorSpecVersion.create({ trackKey, version, text });

  const before = { behaviorSpecVersion: track.behaviorSpecVersion };
  track.behaviorSpecVersion = version;
  track.behaviorSpecText = text;
  await track.save();

  await recordAudit({
    actorId: admin._id,
    action: 'track.behavior-spec-publish',
    entity: 'track',
    entityId: track._id,
    before,
    after: { behaviorSpecVersion: version, specId: spec._id },
  });

  console.log(`Published ${trackKey} behavior spec ${version} (${text.length} chars).`);
  if (track.packMode === 'vocab-only' && track.packText) {
    console.log('Split-mode structuring for this track is now live.');
  }
} finally {
  await disconnectMongo();
}
