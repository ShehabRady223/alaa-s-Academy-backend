import { z } from 'zod';
import { RESULT_RELEASE } from '../types/exam';
import { pagination } from './common';
import { questionInput } from './questions';

const nullableDate = z.union([z.null(), z.coerce.date()]);
const fields = {
  title: z.string().trim().min(2).max(160), subject: z.string().trim().min(1).max(80), description: z.string().trim().max(2000), instructions: z.string().trim().max(5000),
  durationMinutes: z.number().int().min(1).max(600).nullable(), passingScore: z.number().min(0).max(100), maxAttempts: z.number().int().min(1).max(10),
  startDate: nullableDate, expiresAt: nullableDate,
  settings: z.object({ shuffleQuestions: z.boolean(), shuffleOptions: z.boolean(), resultRelease: z.enum(RESULT_RELEASE), showCorrectAnswers: z.boolean() }).partial(),
  questions: z.array(questionInput).max(200),
};
const datesOk = (v: { startDate?: Date | null; expiresAt?: Date | null }) => !v.startDate || !v.expiresAt || v.expiresAt > v.startDate;
const datesMsg = { message: 'Expiry must be after the start date', path: ['expiresAt'] };

export const createExamBody = z.object({ ...z.object(fields).partial().shape, title: fields.title }).refine(datesOk, datesMsg);
export const updateExamBody = z.object(fields).partial().refine(datesOk, datesMsg);
export const listExamsQuery = z.object({
  ...pagination, search: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'published', 'archived', 'scheduled', 'active', 'expired']).optional(),
});
export type ListExamsQuery = z.infer<typeof listExamsQuery>;
export type ExamFields = z.infer<typeof updateExamBody>;
