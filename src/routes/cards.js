/**
 * Card + home routes for the signed-in user. All permission decisions
 * live in cardService (server law); routes translate HTTP ↔ service.
 */

import { Router } from 'express';
import { Track } from '../models/Track.js';
import * as cards from '../services/cardService.js';
import * as confirm from '../services/confirmService.js';
import * as verdictFlow from '../services/verdictService.js';
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

// --- Reader (P5): ladder read (FR-19) + quarterly assembly (FR-20) ---
router.get('/api/ladder', async (req, res, next) => {
  try {
    const { deriveFromCards } = await import('../services/readerService.js');
    const confirmed = await cards.listOwnCards(req.currentUser);
    const read = deriveFromCards(
      req.currentUser.track,
      confirmed.filter((c) => c.status === 'confirmed'),
    );
    const latestGap = confirmed.find((c) => c.honestGap)?.honestGap ?? null;
    sendSuccess(res, { ...read, honestGap: latestGap });
  } catch (err) {
    next(err);
  }
});

router.get('/api/quarters', async (req, res, next) => {
  try {
    const own = await cards.listOwnCards(req.currentUser);
    const confirmed = own.filter((c) => c.status === 'confirmed');
    const byQuarter = {};
    for (const card of confirmed) {
      const tag = card.periodTag ?? 'untagged';
      byQuarter[tag] = byQuarter[tag] || [];
      byQuarter[tag].push({
        _id: card._id,
        subject: card.subject,
        claims: card.claims.length,
        status: card.status,
      });
    }
    sendSuccess(res, byQuarter);
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

// --- A1/C3: exposure sign-off — the verifier setting decides who may
// act; there is no substitution input on this endpoint by construction.
router.get('/api/signoffs', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.signoffQueue(req.currentUser));
  } catch (err) {
    next(err);
  }
});

router.post('/api/cards/:id/signoff', async (req, res, next) => {
  try {
    sendSuccess(res, await confirm.decideSignoff(req.currentUser, req.params.id, req.body ?? {}));
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

// --- C1: the assigned reviewer refuses after JP's ruling — final position
// logged permanently; the card auto-reassigns to the fallback reviewer.
router.post('/api/cards/:id/refuse-ruling', async (req, res, next) => {
  try {
    sendSuccess(res, await verdictFlow.refuseAfterRuling(req.currentUser, req.params.id, req.body?.statement));
  } catch (err) {
    next(err);
  }
});

export default router;
