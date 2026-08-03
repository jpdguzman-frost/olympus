/** Lead surface: reports list, card shells (FR-5), confirmed records. */

import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { User } from '../models/User.js';
import * as cards from '../services/cardService.js';
import { leadNomineeQueue } from '../services/confirmService.js';
import { sendSuccess } from '../utils/responseEnvelope.js';

const router = Router();

// FR-14/FR-17: cards awaiting this lead's nominee decision, with repeat streaks
router.get('/api/team/nominee-queue', requireRole('lead'), async (req, res, next) => {
  try {
    sendSuccess(res, await leadNomineeQueue(req.currentUser));
  } catch (err) {
    next(err);
  }
});

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

router.post('/api/team/shells', requireRole('lead'), async (req, res, next) => {
  try {
    const { reportUserId, subjectName, closeDate } = req.body ?? {};
    sendSuccess(res, await cards.createShell(req.currentUser, { reportUserId, subjectName, closeDate }), 201);
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
