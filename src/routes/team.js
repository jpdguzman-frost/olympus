/** Lead surface: reports list, card shells (FR-5), confirmed records. */

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

export default router;
