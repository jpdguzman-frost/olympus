/**
 * Card + home routes for the signed-in user. All permission decisions
 * live in cardService (server law); routes translate HTTP ↔ service.
 */

import { Router } from 'express';
import { Track } from '../models/Track.js';
import * as cards from '../services/cardService.js';
import { sendSuccess } from '../utils/responseEnvelope.js';

const router = Router();

// --- Home (FR-2): ladder position (P5 placeholder), confirmed, drafts ---
router.get('/api/home', async (req, res, next) => {
  try {
    const own = await cards.listOwnCards(req.currentUser);
    const track = req.currentUser.track
      ? await Track.findOne({ key: req.currentUser.track })
      : null;
    sendSuccess(res, {
      ladder: null, // level derivation arrives in P5 (reader service)
      confirmed: own.filter((c) => c.status === 'confirmed'),
      drafts: own.filter((c) => c.status === 'draft'),
      inFlight: own.filter((c) => !['draft', 'confirmed', 'archived'].includes(c.status)),
      track: track && {
        key: track.key,
        label: track.label,
        questionSet: track.questionSet,
        competencyOrDomainList: track.competencyOrDomainList,
        vocabPackVersion: track.vocabPackVersion,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/me', (req, res) => {
  const u = req.currentUser;
  sendSuccess(res, { id: u.id, name: u.name, email: u.email, roles: u.roles, track: u.track });
});

// --- FR-6 pre-fill boundary: context read, never an answer write ---
router.get('/api/cards/context', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.confirmedContext(req.currentUser, req.query.subjectName || null));
  } catch (err) {
    next(err);
  }
});

// --- Reviewer queue (visibility: only cards routed to me) ---
router.get('/api/queue', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.listQueue(req.currentUser));
  } catch (err) {
    next(err);
  }
});

// --- Own cards ---
router.get('/api/cards', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.listOwnCards(req.currentUser));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards', async (req, res, next) => {
  try {
    const { subjectName, closeDate, captureMode } = req.body ?? {};
    sendSuccess(res, await cards.createDraft(req.currentUser, { subjectName, closeDate, captureMode }), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/api/cards/:id', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.getCardForRead(req.currentUser, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.patch('/api/cards/:id', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.updateDraft(req.currentUser, req.params.id, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards/:id/submit', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.submitForStructuring(req.currentUser, req.params.id));
  } catch (err) {
    next(err);
  }
});

// --- Nomination (Plan §4: talent tags; lead decides; nobody substitutes) ---
router.post('/api/cards/:id/nominees', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.setNominees(req.currentUser, req.params.id, req.body?.nominees));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards/:id/nominee-decision', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.leadNomineeDecision(req.currentUser, req.params.id, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

// --- Verdict (Invariant 3: assigned non-advocate only, enforced in service) ---
router.post('/api/cards/:id/claims/:claimId/verdict', async (req, res, next) => {
  try {
    sendSuccess(res, await cards.applyVerdict(req.currentUser, req.params.id, req.params.claimId, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
