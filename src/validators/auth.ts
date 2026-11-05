import { z } from 'zod';

export const passwordRule = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

export const loginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
export const forgotBody = z.object({ email: z.string().email() });
export const setPasswordBody = z.object({ token: z.string().min(20).max(200), password: passwordRule });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: passwordRule });
