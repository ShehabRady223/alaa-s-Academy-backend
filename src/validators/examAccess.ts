import { z } from 'zod';
import { objectId, pagination } from './common';

export const createAccessBody = z.object({
  examId: objectId,
  studentIds: z.array(objectId).min(1).max(100).refine((a) => new Set(a).size === a.length, 'Duplicate students'),
  expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});
export type CreateAccessInput = z.infer<typeof createAccessBody>;

export const listAccessQuery = z.object({
  ...pagination, examId: objectId.optional(), studentId: objectId.optional(),
  status: z.enum(['active', 'revoked', 'completed']).optional(),
  ids: z.string().regex(/^[a-f\d]{24}(,[a-f\d]{24}){0,99}$/i, 'Invalid ids').optional(), // for the QR print sheet
});
export type ListAccessQuery = z.infer<typeof listAccessQuery>;
export const enterBody = z.object({ token: z.string().min(20).max(200) });
export const qrQuery = z.object({ format: z.enum(['png', 'svg']).default('png'), download: z.enum(['0', '1']).default('0') });
