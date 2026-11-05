import { z } from 'zod';
import { objectId, pagination } from './common';

export const listResultsQuery = z.object({ ...pagination, examId: objectId.optional(), studentId: objectId.optional(), status: z.enum(['graded', 'pending_review']).optional() });
export const gradeBody = z.object({
  grades: z.array(z.object({ questionId: objectId, points: z.number().min(0).max(100), feedback: z.string().trim().max(2000).optional() })).min(1).max(200),
});
export const releaseBody = z.object({ examId: objectId });
export const questionStatsQuery = z.object({ examId: objectId.optional() });
export const reportQuery = z.object({ examId: objectId.optional(), studentId: objectId.optional() });
export const notificationsQuery = z.object({ ...pagination, unread: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') });
export const settingsBody = z.object({
  academyName: z.string().trim().min(1).max(120), contactEmail: z.string().trim().email().max(200).or(z.literal('')),
  defaultPassingScore: z.number().min(0).max(100), defaultMaxAttempts: z.number().int().min(1).max(10),
}).partial();
