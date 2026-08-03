/**
 * Express app construction — extracted from server.js so the HTTP layer
 * can be exercised by supertest without the bootstrap sequence (Ares
 * parity). server.js owns env validation, Mongo, seeding, listen, and
 * shutdown; this file owns middleware composition and the route tree.
 */

import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

import { errorHandler } from './middleware/errorHandler.js';
import { ensureAuthenticated, userLoader } from './middleware/auth.js';
import { configurePassport } from './config/passport.js';
import { buildSessionConfig } from './config/sessionConfig.js';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import cardsRouter from './routes/cards.js';
import teamRouter from './routes/team.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export async function createApp({ publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  const app = express();

  // Redis-backed sessions in prod; express-session's in-memory store when
  // REDIS_URL is unset (tests). envValidation requires REDIS_URL in prod.
  const sessionRedis = process.env.REDIS_URL
    ? new (await import('ioredis')).default(process.env.REDIS_URL, { lazyConnect: false })
    : null;

  app.use(session(buildSessionConfig({ sessionRedis })));

  const passport = configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(userLoader);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(publicDir));

  app.use(healthRouter);
  app.use(authRouter);

  // Everything under /api requires a session (NFR-1 starts at the door).
  app.use('/api', ensureAuthenticated);
  app.use(cardsRouter);
  app.use(teamRouter);
  app.use(adminRouter);

  app.use(errorHandler);

  return { app, sessionRedis };
}
