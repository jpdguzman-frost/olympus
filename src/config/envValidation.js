/**
 * Fail-fast env validation (Ares parity).
 *
 * Production requires the full set. Development degrades deliberately:
 * missing Google credentials enable the dev-login path (auth.js), and a
 * missing SESSION_SECRET falls back to a fixed dev value — both refuse
 * to operate in production.
 */

const DEV_SESSION_SECRET = 'olympus-dev-secret-not-for-production';

export function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

export function hasGoogleAuth(env = process.env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function validateEnv(env = process.env) {
  const problems = [];

  if (!env.MONGODB_URI) {
    env.MONGODB_URI = 'mongodb://localhost:27017/olympus';
  }

  if (!env.ALLOWED_EMAIL_DOMAINS) {
    // FR-1: Frost domain restricted. Default keeps the gate closed rather
    // than open when the variable is forgotten.
    env.ALLOWED_EMAIL_DOMAINS = 'frostdesigngroup.com';
  }

  if (!env.SESSION_SECRET) {
    if (isProduction(env)) {
      problems.push('SESSION_SECRET is required in production');
    } else {
      env.SESSION_SECRET = DEV_SESSION_SECRET;
    }
  }

  if (isProduction(env)) {
    if (!hasGoogleAuth(env)) {
      problems.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are required in production (dev login is dev-only)');
    }
    if (!env.REDIS_URL) {
      problems.push('REDIS_URL is required in production (sessions)');
    }
  }

  if (problems.length) {
    console.error('Environment validation failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (!hasGoogleAuth(env) && !isProduction(env)) {
    console.warn('[env] Google OAuth not configured — dev login enabled (dev only)');
  }
}
