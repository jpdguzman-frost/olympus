/**
 * Admin surface (P-4): user/track admin, vocab pack publishing (Plan §4),
 * audit reads. Admin has NO verdict rights — there is deliberately no
 * admin verdict route, and the service guard rejects admin anyway
 * (Invariant 3).
 */

import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { Track } from '../models/Track.js';
import { VocabPackVersion } from '../models/VocabPackVersion.js';
import { AuditLog } from '../models/AuditLog.js';
import { Card } from '../models/Card.js';
import { recordAudit } from '../services/auditService.js';
import * as calibration from '../services/calibrationService.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { sendSuccess } from '../utils/responseEnvelope.js';
import { ROLES, TRACK_KEYS } from '../config/constants.js';

const router = Router();

router.use('/api/admin', requireRole('admin'));

// --- Users ---
router.get('/api/admin/users', async (req, res, next) => {
  try {
    sendSuccess(res, await User.find().sort({ name: 1 }));
  } catch (err) {
    next(err);
  }
});

router.post('/api/admin/users', async (req, res, next) => {
  try {
    const { email, name, roles = [], track = null, leadId = null } = req.body ?? {};
    if (!email || !name) throw badRequest('email and name are required');
    if (!roles.every((r) => ROLES.includes(r))) throw badRequest('Unknown role');
    if (track && !TRACK_KEYS.includes(track)) throw badRequest('Unknown track');
    const user = await User.create({ email, name, roles, track, leadId });
    await recordAudit({
      actorId: req.currentUser._id, action: 'user.create', entity: 'user', entityId: user._id,
      after: { email, name, roles, track },
    });
    sendSuccess(res, user, 201);
  } catch (err) {
    next(err);
  }
});

router.patch('/api/admin/users/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw notFound('User not found');
    const before = { name: user.name, roles: [...user.roles], track: user.track, leadId: user.leadId, active: user.active };

    const { name, roles, track, leadId, active } = req.body ?? {};
    if (name !== undefined) user.name = name;
    if (roles !== undefined) {
      if (!roles.every((r) => ROLES.includes(r))) throw badRequest('Unknown role');
      user.roles = roles;
    }
    if (track !== undefined) {
      if (track && !TRACK_KEYS.includes(track)) throw badRequest('Unknown track');
      user.track = track;
    }
    if (leadId !== undefined) user.leadId = leadId;
    if (active !== undefined) user.active = Boolean(active);
    await user.save();

    await recordAudit({
      actorId: req.currentUser._id, action: 'user.update', entity: 'user', entityId: user._id,
      before, after: { name: user.name, roles: user.roles, track: user.track, leadId: user.leadId, active: user.active },
    });
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
});

// --- Tracks + vocab packs (Invariant 1: versioned, immutable, append-only) ---
router.get('/api/admin/tracks', async (req, res, next) => {
  try {
    sendSuccess(res, await Track.find());
  } catch (err) {
    next(err);
  }
});

router.post('/api/admin/tracks/:key/pack', async (req, res, next) => {
  try {
    const track = await Track.findOne({ key: req.params.key });
    if (!track) throw notFound('Track not found');
    const { version, packText, competencyOrDomainList } = req.body ?? {};
    if (!version || !packText) throw badRequest('version and packText are required');

    const pack = await VocabPackVersion.create({ trackKey: track.key, version, packText });
    const before = { vocabPackVersion: track.vocabPackVersion };
    track.vocabPackVersion = version;
    track.packText = packText;
    if (Array.isArray(competencyOrDomainList)) track.competencyOrDomainList = competencyOrDomainList;
    await track.save();

    await recordAudit({
      actorId: req.currentUser._id, action: 'track.pack-publish', entity: 'track', entityId: track._id,
      before, after: { vocabPackVersion: version, packId: pack._id },
    });
    sendSuccess(res, track, 201);
  } catch (err) {
    next(err);
  }
});

// --- Calibration review (FR-11; admin-only per Plan §4 matrix) ---
router.get('/api/admin/calibration', async (req, res, next) => {
  try {
    sendSuccess(res, await calibration.listCalibrationQueue());
  } catch (err) {
    next(err);
  }
});

router.post('/api/admin/calibration/:cardId/claims/:claimId', async (req, res, next) => {
  try {
    sendSuccess(res, await calibration.correctClaim(req.currentUser, req.params.cardId, req.params.claimId, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/api/admin/calibration/:cardId/release', async (req, res, next) => {
  try {
    sendSuccess(res, await calibration.releaseCard(req.currentUser, req.params.cardId));
  } catch (err) {
    next(err);
  }
});

// Calibration mode toggle — the GATE-1 exit decision is JP's (Invariant 14);
// this endpoint only records it.
router.post('/api/admin/tracks/:key/calibration-mode', async (req, res, next) => {
  try {
    const track = await Track.findOne({ key: req.params.key });
    if (!track) throw notFound('Track not found');
    const before = { calibrationMode: track.calibrationMode };
    track.calibrationMode = Boolean(req.body?.on);
    await track.save();
    await recordAudit({
      actorId: req.currentUser._id, action: 'track.calibration-mode', entity: 'track', entityId: track._id,
      before, after: { calibrationMode: track.calibrationMode },
    });
    sendSuccess(res, track);
  } catch (err) {
    next(err);
  }
});

// --- Reads: admin reads all (Plan §4) ---
router.get('/api/admin/cards', async (req, res, next) => {
  try {
    sendSuccess(res, await Card.find().sort({ updatedAt: -1 }).limit(200));
  } catch (err) {
    next(err);
  }
});

router.get('/api/admin/audit', async (req, res, next) => {
  try {
    const query = {};
    if (req.query.entity) query.entity = req.query.entity;
    if (req.query.entityId) query.entityId = req.query.entityId;
    sendSuccess(res, await AuditLog.find(query).sort({ createdAt: -1 }).limit(200));
  } catch (err) {
    next(err);
  }
});

export default router;
