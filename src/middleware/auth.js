/**
 * Authentication middleware.
 *
 * Sessions carry only the user id. userLoader re-reads the user document
 * on every request so roles and active status take effect immediately —
 * roles come from Mongo, never from the session (Plan §4, NFR-1).
 */

import { User } from '../models/User.js';
import { sendErrorResponse } from '../utils/responseEnvelope.js';

export async function userLoader(req, res, next) {
  if (req.isAuthenticated?.() && req.user?.id) {
    try {
      const user = await User.findById(req.user.id);
      if (user && user.active) req.currentUser = user;
    } catch (err) {
      return next(err);
    }
  }
  next();
}

export function ensureAuthenticated(req, res, next) {
  if (req.currentUser) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return sendErrorResponse(res, 401, 'Please log in to access this resource');
  }
  return res.redirect('/login.html');
}

/** Role gate — NFR-1: server-side, the client is untrusted. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return sendErrorResponse(res, 401, 'Please log in to access this resource');
    }
    if (!roles.some((r) => req.currentUser.roles.includes(r))) {
      return sendErrorResponse(res, 403, 'Your role does not permit this action');
    }
    next();
  };
}
