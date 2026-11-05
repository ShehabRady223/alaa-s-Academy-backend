import { z } from 'zod';
import { objectId, pagination } from './common';
import { questionInput } from './questions';

const students = z.array(objectId).max(200).refine((a) => new Set(a).size === a.length, 'Duplicate students');
const due = z.union([z.null(), z.coerce.date()]);
const fields = {
  title: z.string().trim().min(2).max(160), subject: z.string().trim().min(1).max(80), description: z.string().trim().max(2000), instructions: z.string().trim().max(5000),
  questions: z.array(questionInput).min(1, 'Add at least one question').max(50), studentIds: students, dueDate: due, allowLate: z.boolean(),
};
export const createAssignmentBody = z.object({ ...z.object(fields).partial().shape, title: fields.title, questions: fields.questions, publish: z.boolean().optional() });
export const updateAssignmentBody = z.object(fields).partial();
export const listAssignmentsQuery = z.object({ ...pagination, status: z.enum(['draft', 'published', 'closed']).optional(), search: z.string().trim().max(100).optional() });
export const gradeBody = z.object({
  grades: z.array(z.object({ questionId: objectId, points: z.number().min(0).max(100), feedback: z.string().trim().max(2000).optional() })).min(1).max(50),
  feedback: z.string().trim().max(2000).optional(),
});
export const answersBody = z.object({ answers: z.array(z.object({ questionId: objectId, response: z.union([z.string().max(20000), z.array(z.string().max(64)).max(8), z.null()]) })).max(50) });
export const submissionParams = z.object({ id: objectId, sid: objectId });
export type CreateAssignmentInput = z.infer<typeof createAssignmentBody>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentBody>;
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuery>;
