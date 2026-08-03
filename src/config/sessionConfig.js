/**
 * Session config builder — pure factory separated from createApp so the
 * configuration is unit-testable and hardening changes land in one place.
 * (Ares parity, including the connect-redis v9 → ioredis adapter.)
 */

import { RedisStore } from 'connect-redis';
import { SESSION_MAX_AGE_MS } from './constants.js';

/** Thin adapter: translates connect-redis v9 calls to ioredis equivalents. */
export function createSessionAdapter(ioredis) {
  return {
    get: (key) => ioredis.get(key),
    set: (key, val, opts) => {
      if (opts && opts.expiration) {
        return ioredis.set(key, val, opts.expiration.type, opts.expiration.value);
      }
      return ioredis.set(key, val);
    },
    del: (keys) => ioredis.del(...(Array.isArray(keys) ? keys : [keys])),
    expire: (key, ttl) => ioredis.expire(key, ttl),
    scanIterator: (opts) => ioredis.scanStream({ match: opts.MATCH, count: opts.COUNT }),
    quit: () => ioredis.quit(),
  };
}

/**
 * Build the express-session options. With `sessionRedis`, a connect-redis
 * store is wired in; otherwise express-session's in-memory store (tests /
 * bare dev only).
 */
export function buildSessionConfig({ sessionRedis = null, env = process.env } = {}) {
  const config = {
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    },
  };
  if (sessionRedis) {
    config.store = new RedisStore({
      client: createSessionAdapter(sessionRedis),
      prefix: 'olympus:session:',
    });
  }
  return config;
}
