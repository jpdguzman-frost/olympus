/**
 * Lead surface, as amended by A1/C4: read-only — reports and their
 * confirmed records. Shells are retired; nominee approval is retired
 * (the exposure sign-off lives on the main app, keyed to the
 * exposure-verifier setting, not the lead role).
 */

import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { User } from '../models/User.js';
import * as cards from '../services/cardService.js';
import { sendSuccess } from '../utils/responseEnvelope.js';

const router = Router();

router.get('/api/team/reports', requireRole('lead'), async (req, res, next) => {
  try {
    const reports = await User.find(
      { leadId: req.currentUser._id, active: true },
      { name: 1, email: 1, track: 1 },
    ).sort({ name: 1 });
    sendSuccess(res, reports);
  } catch (err) {
    next(err);
  }
});

router.get('/api/team/cards', requireRole('lead'), async (req, res, next) => {
  try {
    sendSuccess(res, await cards.listTeamConfirmed(req.currentUser));
  } catch (err) {
    next(err);
  }
});

// FR-20: per-team quarterly assembly — counts and statuses only (Invariant 12)
router.get('/api/team/quarters', requireRole('lead'), async (req, res, next) => {
  try {
    const confirmed = await cards.listTeamConfirmed(req.currentUser);
    const reports = await User.find({ leadId: req.currentUser._id }, { name: 1 });
    const names = Object.fromEntries(reports.map((r) => [r._id.toString(), r.name]));
    const byQuarter = {};
    for (const card of confirmed) {
      const tag = card.periodTag ?? 'untagged';
      byQuarter[tag] = byQuarter[tag] || [];
      byQuarter[tag].push({
        _id: card._id,
        subject: card.subject,
        talentName: names[card.talentId.toString()],
        claims: card.claims.length,
        status: card.status,
      });
    }
    sendSuccess(res, byQuarter);
  } catch (err) {
    next(err);
  }
});

export default router;
