/**
 * users { googleId, name, roles[], track, leadId, active } — Plan §3.
 * email added for the FR-1 domain-restricted sign-in match.
 * Roles live HERE, never in the OAuth profile or the session (Plan §4).
 */

import mongoose from 'mongoose';
import { ROLES, TRACK_KEYS } from '../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, index: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    roles: [{ type: String, enum: ROLES }],
    track: { type: String, enum: [...TRACK_KEYS, null], default: null },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.methods.hasRole = function hasRole(role) {
  return this.roles.includes(role);
};

export const User = mongoose.model('User', userSchema);
