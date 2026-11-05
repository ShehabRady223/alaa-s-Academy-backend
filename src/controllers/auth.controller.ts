import { Request } from 'express';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import * as auth from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from '../utils/cookies';
import { AppError, forbidden, unauthorized } from '../utils/errors';

const meta = (req: Request) => ({ ip: req.ip, ua: req.get('user-agent') });

export const login = asyncHandler(async (req, res) => {
  const s = await auth.login(req.body.email, req.body.password, meta(req));
  setSessionCookies(res, s.access, s.refresh);
  res.json({ user: s.user });
});

export const refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) throw new AppError(401, 'Authentication required', 'NO_REFRESH');
  try {
    const s = await auth.refreshSession(raw, meta(req));
    setSessionCookies(res, s.access, s.refresh);
    res.json({ user: s.user });
  } catch (e) {
    // Dead session => drop cookies. A race must NOT clear them: the winning tab just set fresh ones.
    if (e instanceof AppError && e.code !== 'REFRESH_RACE') clearSessionCookies(res);
    throw e;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await auth.endSession(req.cookies?.[REFRESH_COOKIE] as string | undefined);
  clearSessionCookies(res);
  res.status(204).end();
});

export const logoutAll = asyncHandler(async (req, res) => {
  await auth.revokeAllSessions(req.user!.id);
  clearSessionCookies(res);
  res.status(204).end();
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw unauthorized();
  if (user.role === 'student' && (await StudentProfile.findOne({ userId: user._id }).select('status').lean())?.status !== 'active') throw forbidden('This account is not active');
  res.json({ user: auth.publicUser(user) });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await auth.forgotPassword(req.body.email);
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

export const setPassword = asyncHandler(async (req, res) => {
  const s = await auth.setPasswordWithToken(req.body.token, req.body.password, meta(req));
  setSessionCookies(res, s.access, s.refresh);
  res.json({ user: s.user });
});

export const changePassword = asyncHandler(async (req, res) => {
  await auth.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
  const user = await User.findById(req.user!.id);
  if (!user) throw unauthorized();
  const s = await auth.login(user.email, req.body.newPassword, meta(req)); // fresh session for this device only
  setSessionCookies(res, s.access, s.refresh);
  res.status(204).end();
});
