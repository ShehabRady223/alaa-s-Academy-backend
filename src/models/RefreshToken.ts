import { Schema, model } from 'mongoose';

/**
 * One row per refresh token ever issued. Tokens in the same login share a `familyId`.
 * Rotation marks the old row `usedAt`; presenting a used token again is replay (theft) and revokes the family.
 * Only the SHA-256 hash is stored, never the token itself.
 */
const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    // Unique: the id of the token this one replaces (or `root:<familyId>` for a fresh login). Two concurrent rotations of the
    // same token would create two children with the same claimKey, so the database itself guarantees exactly one wins.
    claimKey: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true }, // sliding, capped by familyExpiresAt
    familyExpiresAt: { type: Date, required: true }, // absolute end of the login session
    usedAt: { type: Date },
    revokedAt: { type: Date },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ familyId: 1 }); // revoke a whole family
schema.index({ userId: 1 }); // revoke all sessions of a user
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // housekeeping

export const RefreshToken = model('RefreshToken', schema);
