import { z } from 'zod';
import { objectId } from './common';

const answerIn = z.object({
  questionId: objectId,
  response: z.union([z.string().max(20000), z.array(z.string().max(64)).max(8), z.null()]),
  timeSpentSec: z.number().int().min(0).max(86400).optional(),
});
export const autosaveBody = z.object({ answers: z.array(answerIn).max(200) });
export const submitBody = z.object({ answers: z.array(answerIn).max(200).optional() });
export type AnswerIn = z.infer<typeof answerIn>;
