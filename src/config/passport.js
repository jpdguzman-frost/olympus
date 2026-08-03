/**
 * Passport Google OAuth configuration (Ares parity).
 *
 * Gate login on an email-domain allowlist (ALLOWED_EMAIL_DOMAINS) — FR-1.
 * envValidation defaults the allowlist to frostdesigngroup.com so the gate
 * fails closed when the variable is forgotten.
 *
 * A Google account that passes the domain gate must ALSO exist as an active
 * user record — roles come from the users collection (Plan §4), never from
 * the OAuth profile.
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/User.js';
import { hasGoogleAuth } from './envValidation.js';

export function parseAllowedDomains(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * The '@' prefix in the endsWith check is load-bearing: without it,
 * evil-frostdesigngroup.com would pass a list entry of frostdesigngroup.com.
 */
export function isEmailAllowed(email, allowedDomains) {
  if (!email || typeof email !== 'string') return false;
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) return false;
  const lower = email.toLowerCase();
  return allowedDomains.some((domain) => lower.endsWith('@' + domain));
}

/**
 * Translate a Google profile into an accepted session user or a rejection.
 * Sessions carry only the user id; roles are re-read from Mongo on each
 * request (userLoader middleware) so a role change takes effect immediately.
 */
export async function handleGoogleProfile(profile, allowedDomains, done) {
  try {
    const email = profile?.emails?.[0]?.value?.toLowerCase();
    if (!isEmailAllowed(email, allowedDomains)) return done(null, false);

    let user = await User.findOne({ email, active: true });
    if (!user) {
      user = await User.findOneAndUpdate(
        { googleId: profile.id, active: true },
        { $set: { email } },
        { new: true },
      );
    }
    if (!user) return done(null, false);

    if (!user.googleId) {
      user.googleId = profile.id;
      await user.save();
    }
    return done(null, { id: user.id });
  } catch (err) {
    return done(err);
  }
}

export function configurePassport() {
  const allowedDomains = parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => done(null, { id }));

  if (hasGoogleAuth()) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        },
        (accessToken, refreshToken, profile, done) =>
          handleGoogleProfile(profile, allowedDomains, done),
      ),
    );
  }

  return passport;
}
