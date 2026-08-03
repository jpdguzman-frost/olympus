/**
 * Card + home routes for the signed-in user. All permission decisions
 * live in cardService (server law); routes translate HTTP ↔ service.
 */

import { Router } from 'express';
import { Track } from '../models/Track.js';
import * as cards from '../services/cardService.js';
import * as confirm from '../services/confirmService.js';
import { sendSuccess } from '../utils/responseEnvelope.js';

const router = Router();

// --- Home (FR-2): ladder position (P5 placeholder), confirmed, drafts ---
router.get('/api/home', async (req, res, next) => {
  try {
    const own = cards.presentCards(req.currentUser, await cards.listOwnCards(req.currentUser));
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
        controlledVocabulary: track.controlledVocabulary,
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
    sendSuccess(res, cards.presentCards(req.currentUser, await cards.listOwnCards(req.currentUser)));
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
    const card = await cards.getCardForRead(req.currentUser, req.params.id);
    sendSuccess(res, cards.presentCard(req.currentUser, card));
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

// --- Confirm flow (FR-12): per-claim approve/fix, follow-ups, full approval ---
router.post('/api/cards/:id/claims/:claimId/decide', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.decideClaim(req.currentUser, req.params.id, req.params.claimId, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards/:id/follow-ups/:followUpId/answer', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.answerFollowUp(req.currentUser, req.params.id, req.params.followUpId, req.body?.answer));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards/:id/approve', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.approveCard(req.currentUser, req.params.id, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

// --- Nomination (FR-13/FR-15: talent tags with system checks; nobody substitutes) ---
router.get('/api/nominee-candidates', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.nomineeCandidates(req.currentUser));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards/:id/nominate', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.submitNomination(req.currentUser, req.params.id, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

// --- Lead decision (FR-14/FR-17: select among the talent's nominees, or reject) ---
router.post('/api/cards/:id/nominee-decision', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.decideNomination(req.currentUser, req.params.id, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

// --- Adjust → revise → re-route (FR-16) ---
router.post('/api/cards/:id/reroute', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.rerouteAfterRevision(req.currentUser, req.params.id));
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
