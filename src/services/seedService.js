/**
 * First-boot seeding.
 *
 * Tracks carry the four fixed questions VERBATIM from Plan §5 — FR-3
 * renders these exact strings. competencyOrDomainList stays EMPTY until
 * the versioned vocab packs are loaded (Invariant 1: the app never
 * invents vocabulary; the sweep UI states the list is pending).
 *
 * Users: JP's admin account is always ensured. The demo cast (Karen,
 * Gwyn, Jacob, Dev Lead) seeds ONLY outside production, with
 * unmistakably fake dev emails — real users are created via admin.
 */

import { Track } from '../models/Track.js';
import { User } from '../models/User.js';
import { isProduction } from '../config/envValidation.js';

export const OPS_QUESTIONS = [
  'What account and work is this, and since when?',
  'What do you run yourself day to day — and what does someone still check behind you?',
  'What calls did you make alone here — and who made the other calls?',
  'Did anything break or change along the way? What did you do?',
];

export const ARTASSET_QUESTIONS = [
  'What project was this, and what did you make on it?',
  'When your work went out — did anyone open the file after you and change it, or did it ship as you made it? Do you fix other people\'s files?',
  'The direction — did one already exist? If you made or changed one: who shaped it, who decided it, who carried it — and how many people touched it after you?',
  'Do you review others\' work here? What happens to what you pass?',
];

export async function seedIfNeeded() {
  if ((await Track.countDocuments()) === 0) {
    await Track.create([
      { key: 'ops', label: 'Design Ops', questionSet: OPS_QUESTIONS, competencyOrDomainList: [] },
      { key: 'artasset', label: 'Art & Asset', questionSet: ARTASSET_QUESTIONS, competencyOrDomainList: [] },
    ]);
    console.log('[seed] tracks created (ops, artasset) — vocab packs pending');
  }

  const jp = await User.findOne({ email: 'jpdguzman@frostdesigngroup.com' });
  if (!jp) {
    await User.create({
      email: 'jpdguzman@frostdesigngroup.com',
      name: 'JP Guzman',
      roles: ['admin'],
    });
    console.log('[seed] JP admin user created');
  }

  if (!isProduction() && (await User.countDocuments()) < 3) {
    const lead = await User.create({
      email: 'dev-lead@dev.olympus.invalid',
      name: 'Dev Lead',
      roles: ['lead'],
    });
    await User.create([
      { email: 'dev-karen@dev.olympus.invalid', name: 'Karen (dev)', roles: ['talent'], track: 'ops', leadId: lead._id },
      { email: 'dev-jacob@dev.olympus.invalid', name: 'Jacob (dev)', roles: ['talent'], track: 'ops', leadId: lead._id },
      { email: 'dev-gwyn@dev.olympus.invalid', name: 'Gwyn (dev)', roles: ['talent'], track: 'artasset', leadId: lead._id },
      { email: 'dev-reviewer@dev.olympus.invalid', name: 'Reviewer (dev)', roles: ['talent'], track: 'ops', leadId: lead._id },
    ]);
    console.log('[seed] dev users created (dev only — fake emails, cannot pass Google auth)');
  }
}
