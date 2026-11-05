import argon2 from 'argon2';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { JWT_OPTS } from '../middleware/auth';
import { AuthToken } from '../models/AuthToken';
import { RefreshToken } from '../models/RefreshToken';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { AppError, badRequest, forbidden, unauthorized } from '../utils/errors';
import { sendMail } from '../utils/mailer';
import { generateToken, sha256 } from '../utils/tokens';

const HOUR = 3600_000, DAY = 24 * HOUR;
const TTL = { invite: 72 * HOUR, reset: 1 * HOUR } as const;
/** Two tabs may refresh with the same cookie at once. A token used this recently is a race, not theft. */
const RACE_GRACE_MS = 10_000;

export interface SessionMeta { ip?: string; ua?: string }
export interface Session { user: ReturnType<typeof publicUser>; access: string; refresh: string }

export const signAccess = (userId: string, role: string) =>
  jwt.sign({ sub: userId, role, typ: 'access' }, env.JWT_SECRET, { ...JWT_OPTS, algorithm: 'HS256', expiresIn: `${env.ACCESS_TOKEN_MINUTES}m` });

export const publicUser = (u: { id?: string; name: string; email: string; role: string; avatar?: string | null }) => ({
  id: u.id as string, name: u.name, email: u.email, role: u.role, avatar: u.avatar ?? null,
});

const DUMMY_HASH = argon2.hash('dummy-password-for-timing'); // equalises timing for unknown emails

// ---------- refresh-token sessions ----------
async function issueRefresh(userId: string, familyId: string, familyExpiresAt: Date, meta: SessionMeta, claimKey = `root:${familyId}`) {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Math.min(Date.now() + env.REFRESH_TOKEN_DAYS * DAY, familyExpiresAt.getTime()));
  await RefreshToken.create({ userId, familyId, claimKey, tokenHash: hash, expiresAt, familyExpiresAt, ip: meta.ip, userAgent: meta.ua?.slice(0, 200) });
  return raw;
}
const revokeFamily = (familyId: string) => RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
export const revokeAllSessions = (userId: string) => RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });

async function studentActive(userId: string, role: string) {
  if (role !== 'student') return true;
  const p = await StudentProfile.findOne({ userId }).select('status').lean();
  return p?.status === 'active';
}

export async function login(email: string, password: string, meta: SessionMeta): Promise<Session> {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, password) : (await argon2.verify(await DUMMY_HASH, password), false);
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  if (user.role === 'student') {
    const profile = await StudentProfile.findOneAndUpdate({ userId: user._id }, { lastActiveAt: new Date() });
    if (profile?.status === 'disabled') throw forbidden('This account has been disabled');
  }
  const refresh = await issueRefresh(user.id, randomUUID(), new Date(Date.now() + env.REFRESH_ABSOLUTE_DAYS * DAY), meta);
  return { user: publicUser(user), access: signAccess(user.id, user.role), refresh };
}

/** Every successful call consumes the presented token and returns a new one (rotation). */
export async function refreshSession(raw: string, meta: SessionMeta): Promise<Session> {
  const tok = await RefreshToken.findOne({ tokenHash: sha256(raw) });
  const fail = (code: string, msg = 'Please sign in again') => new AppError(401, msg, code);
  if (!tok) throw fail('REFRESH_INVALID');
  if (tok.revokedAt) throw fail('REFRESH_REVOKED');
  const now = Date.now();
  if (tok.expiresAt.getTime() <= now || tok.familyExpiresAt.getTime() <= now) throw fail('REFRESH_EXPIRED');

  const reused = async () => {
    const used = (await RefreshToken.findById(tok._id).select('usedAt').lean())?.usedAt;
    if (used && now - used.getTime() < RACE_GRACE_MS) return fail('REFRESH_RACE', 'Session refresh in progress'); // not theft: another tab won
    await revokeFamily(tok.familyId); // an old token came back after it was rotated => assume it was stolen
    console.warn(JSON.stringify({ event: 'refresh_token_reuse', userId: String(tok.userId), familyId: tok.familyId, ip: meta.ip }));
    return fail('REFRESH_REUSE', 'Session ended for your security. Please sign in again.');
  };
  if (tok.usedAt) throw await reused();

  // Atomic claim: only one concurrent request can flip usedAt from null.
  const claimed = await RefreshToken.findOneAndUpdate({ _id: tok._id, usedAt: null, revokedAt: null }, { usedAt: new Date() });
  if (!claimed) throw await reused();

  const user = await User.findById(tok.userId);
  if (!user || !(await studentActive(user.id, user.role))) { await revokeFamily(tok.familyId); throw fail('REFRESH_REVOKED'); }
  let refresh: string;
  try {
    refresh = await issueRefresh(user.id, tok.familyId, tok.familyExpiresAt, meta, String(tok._id));
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw await reused(); // a concurrent request already rotated this token
    throw e;
  }
  return { user: publicUser(user), access: signAccess(user.id, user.role), refresh };
}

/** Logout: ends this login session only. Safe to call with a missing or unknown token. */
export async function endSession(raw?: string) {
  if (!raw) return;
  const tok = await RefreshToken.findOne({ tokenHash: sha256(raw) }).select('familyId').lean();
  if (tok) await revokeFamily(tok.familyId);
}

// ---------- invite / reset links (unchanged behaviour) ----------
export async function issueToken(userId: string, type: 'invite' | 'reset') {
  await AuthToken.deleteMany({ userId, type, usedAt: null });
  const { raw, hash } = generateToken();
  await AuthToken.create({ userId, type, tokenHash: hash, expiresAt: new Date(Date.now() + TTL[type]) });
  return raw;
}
export const buildSetPasswordLink = (raw: string) => `${env.CLIENT_URL}/set-password?token=${raw}`;

export async function sendInvite(user: { id: string; name: string; email: string }) {
  const link = buildSetPasswordLink(await issueToken(user.id, 'invite'));
  const emailed = await sendMail(user.email, "Set up your Alaa's Academy account",
    `Hello ${user.name},\n\nYour teacher has created an account for you at Alaa's Academy.\nChoose your password here (link valid for 72 hours):\n\n${link}\n`);
  return { link, emailed };
}

export async function forgotPassword(email: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return; // never reveal whether an account exists
  if (user.role === 'student' && (await StudentProfile.findOne({ userId: user._id }).select('status').lean())?.status === 'disabled') return;
  const link = buildSetPasswordLink(await issueToken(user.id, 'reset'));
  await sendMail(user.email, "Reset your Alaa's Academy password", `Reset your password (valid for 1 hour):\n\n${link}\n\nIf you did not request this, ignore this email.`);
}

export async function setPasswordWithToken(rawToken: string, password: string, meta: SessionMeta): Promise<Session> {
  const token = await AuthToken.findOneAndUpdate({ tokenHash: sha256(rawToken), usedAt: null, expiresAt: { $gt: new Date() } }, { usedAt: new Date() });
  if (!token) throw badRequest('This link is invalid or has expired. Ask your teacher for a new one.');
  const user = await User.findById(token.userId);
  if (!user) throw badRequest('Account not found');
  user.passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await user.save();
  if (user.role === 'student') await StudentProfile.updateOne({ userId: user._id, status: 'invited' }, { status: 'active' });
  await AuthToken.deleteMany({ userId: user._id, usedAt: null });
  await revokeAllSessions(user.id); // a password reset must end every older session
  const refresh = await issueRefresh(user.id, randomUUID(), new Date(Date.now() + env.REFRESH_ABSOLUTE_DAYS * DAY), meta);
  return { user: publicUser(user), access: signAccess(user.id, user.role), refresh };
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, current))) throw badRequest('Current password is incorrect');
  user.passwordHash = await argon2.hash(next, { type: argon2.argon2id });
  await user.save();
  await revokeAllSessions(userId); // caller re-authenticates (controller issues a fresh session)
}
