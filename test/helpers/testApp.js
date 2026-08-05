/**
 * Shared test context: fresh database, seeded tracks, a fixture cast,
 * and cookie-holding supertest agents logged in via the dev-login path.
 */

import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Track } from '../../src/models/Track.js';
import { Card } from '../../src/models/Card.js';
import { OPS_QUESTIONS, ARTASSET_QUESTIONS } from '../../src/services/seedService.js';
import { transition } from '../../src/services/statusMachine.js';

export async function makeTestContext() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  await Track.create([
    { key: 'ops', label: 'Design Ops', questionSet: OPS_QUESTIONS, competencyOrDomainList: [] },
    { key: 'artasset', label: 'Art & Asset', questionSet: ARTASSET_QUESTIONS, competencyOrDomainList: [] },
  ]);

  const lead = await User.create({ email: 'lead@frostdesigngroup.com', name: 'Lead', roles: ['lead'] });
  const otherLead = await User.create({ email: 'otherlead@frostdesigngroup.com', name: 'Other Lead', roles: ['lead'] });
  const talentA = await User.create({ email: 'a@frostdesigngroup.com', name: 'Talent A', roles: ['talent'], track: 'ops', leadId: lead._id });
  const talentB = await User.create({ email: 'b@frostdesigngroup.com', name: 'Talent B', roles: ['talent'], track: 'ops', leadId: lead._id });
  const reviewer = await User.create({ email: 'rev@frostdesigngroup.com', name: 'Reviewer', roles: ['talent'], track: 'ops', leadId: lead._id });
  const admin = await User.create({ email: 'admin@frostdesigngroup.com', name: 'Admin JP', roles: ['admin'] });

  const { app } = await createApp({ publicDir: process.cwd() });

  async function loginAs(user) {
    const agent = request.agent(app);
    const res = await agent.post('/auth/dev-login').send({ email: user.email });
    if (res.status !== 200) throw new Error(`dev-login failed for ${user.email}: ${res.status}`);
    return agent;
  }

  async function teardown() {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  return { app, loginAs, teardown, users: { lead, otherLead, talentA, talentB, reviewer, admin } };
}

/** Fixture: draft → structured with one claim (server-side transition path). */
export async function structureFixture(cardId, actorId) {
  const card = await Card.findById(cardId);
  card.claims.push({
    type: 'competency',
    competencyOrDomain: 'placeholder-from-pack',
    sourceQuote: 'I ran the weekly builds myself.',
    anchorText: 'GCash, April to June 2026', // A4: fixtures come anchored
    anchorSource: 'structurer',
    flags: [],
  });
  await transition(card, 'structured', actorId);
  await card.save();
  return card;
}

/** Fixture: structured → talent-approved (all claims approved). */
export async function talentApproveFixture(cardId, actorId) {
  const card = await Card.findById(cardId);
  if (card.status === 'draft') await structureFixture(cardId, actorId);
  const fresh = await Card.findById(cardId);
  for (const claim of fresh.claims) claim.talentApproved = true;
  await transition(fresh, 'talent-approved', actorId);
  await fresh.save();
  return fresh;
}

/**
 * Drive a draft card (with one claim) through the status machine to
 * `routed`, assigned to `reviewer` — the fixture for verdict tests.
 * Uses the same server-side transition path production uses.
 */
export async function routeCardTo(cardId, reviewerId, actorId) {
  await talentApproveFixture(cardId, actorId);
  const card = await Card.findById(cardId);
  card.nomination.nominees = [{ userId: reviewerId, name: 'Fixture Reviewer', role: 'confirmer' }];
  await transition(card, 'exposure-signoff', actorId);
  await transition(card, 'routed', actorId);
  card.nomination.routedTo = reviewerId;
  card.nomination.routedAt = new Date();
  await card.save();
  return card;
}
