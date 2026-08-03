/**
 * Auth routes — Google OAuth (FR-1) plus a dev-login path that exists
 * ONLY when Google credentials are absent outside production. The dev
 * path lets the app be demoed and tested without OAuth credentials; it
 * is structurally unreachable in production (envValidation refuses to
 * boot without Google credentials there).
 */

import { Router } from 'express';
import passport from 'passport';
import { User } from '../models/User.js';
import { hasGoogleAuth, isProduction } from '../config/envValidation.js';
import { sendSuccess, sendErrorResponse } from '../utils/responseEnvelope.js';
import { recordAudit } from '../services/auditService.js';

const router = Router();

function devLoginEnabled() {
  return !hasGoogleAuth() && !isProduction();
}

if (hasGoogleAuth()) {
  router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html?error=denied' }),
    (req, res) => res.redirect('/'),
  );
}

router.get('/auth/mode', (req, res) => {
  sendSuccess(res, { google: hasGoogleAuth(), devLogin: devLoginEnabled() });
});

router.get('/auth/dev-users', async (req, res, next) => {
  if (!devLoginEnabled()) return sendErrorResponse(res, 404, 'Not found');
  try {
    const users = await User.find({ active: true }, { email: 1, name: 1, roles: 1, track: 1 }).sort({ name: 1 });
    sendSuccess(res, users);
  } catch (err) {
    next(err);
  }
});

router.post('/auth/dev-login', async (req, res, next) => {
  if (!devLoginEnabled()) return sendErrorResponse(res, 404, 'Not found');
  try {
    const email = String(req.body?.email ?? '').toLowerCase();
    const user = await User.findOne({ email, active: true });
    if (!user) return sendErrorResponse(res, 401, 'No such user');
    req.login({ id: user.id }, async (err) => {
      if (err) return next(err);
      await recordAudit({ actorId: user._id, action: 'auth.dev-login', entity: 'user', entityId: user._id });
      sendSuccess(res, { id: user.id, name: user.name, roles: user.roles });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => sendSuccess(res, { loggedOut: true }));
  });
});

export default router;
