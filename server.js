/**
 * Olympus — Frost Competency Evidence Pipeline — Express server entry point.
 *
 * Bootstrap sequence (Ares-parity):
 *   1. validateEnv() — fail-fast on missing required env
 *   2. connectMongo() — Mongo connection
 *   3. seedIfNeeded() — tracks + dev users when the database is empty
 *   4. createApp() — builds the Express middleware + route tree
 *   5. app.listen()
 *
 * All HTTP-layer composition lives in src/app.js (testable via supertest).
 * All business logic lives under src/services/ and src/routes/.
 */

import 'dotenv/config';

import { validateEnv } from './src/config/envValidation.js';
import { DEFAULT_PORT } from './src/config/constants.js';
import { connectMongo, disconnectMongo } from './src/db/mongo.js';
import { seedIfNeeded } from './src/services/seedService.js';
import { startStructurerWorker, stopStructurerWorker } from './src/workers/structurerWorker.js';
import { startSlaWorker, stopSlaWorker } from './src/workers/slaWorker.js';
import { startLifecycleWorker, stopLifecycleWorker } from './src/workers/lifecycleWorker.js';
import { createApp } from './src/app.js';

// After an uncaught exception / unhandled rejection, Node's state is undefined
// — the process supervisor is responsible for restart.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

validateEnv();

const PORT = process.env.PORT || DEFAULT_PORT;

await connectMongo(process.env.MONGODB_URI);
await seedIfNeeded();

const { app, sessionRedis } = await createApp();

if (process.env.ANTHROPIC_API_KEY) {
  startStructurerWorker();
} else {
  console.warn('[structurer] ANTHROPIC_API_KEY not set — worker not started; submitted cards wait safely in draft');
}
startSlaWorker(); // A5: chases + escalation; non-response is never a verdict
startLifecycleWorker(); // A4: idle drafts archive at 90d, never delete

const server = app.listen(PORT, () => {
  console.log(`Olympus listening on http://localhost:${PORT}`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  stopStructurerWorker();
  stopSlaWorker();
  stopLifecycleWorker();
  server.close(async () => {
    if (sessionRedis) await sessionRedis.quit();
    await disconnectMongo();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
