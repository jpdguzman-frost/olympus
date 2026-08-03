/** CLI seed runner: node scripts/seed.js */

import 'dotenv/config';
import { validateEnv } from '../src/config/envValidation.js';
import { connectMongo, disconnectMongo } from '../src/db/mongo.js';
import { seedIfNeeded } from '../src/services/seedService.js';

validateEnv();
await connectMongo(process.env.MONGODB_URI);
await seedIfNeeded();
await disconnectMongo();
console.log('Seed complete.');
