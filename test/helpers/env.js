/**
 * Test env — set BEFORE any src import reads process.env.
 * No Google creds (dev login on), no Redis (in-memory sessions),
 * a per-worker Mongo database on the local mongod.
 */

process.env.NODE_ENV = 'test';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.REDIS_URL;
process.env.SESSION_SECRET = 'test-secret';
process.env.ALLOWED_EMAIL_DOMAINS = 'frostdesigngroup.com';
process.env.MONGODB_URI = `mongodb://localhost:27017/olympus-test-${process.env.VITEST_POOL_ID ?? 0}`;
