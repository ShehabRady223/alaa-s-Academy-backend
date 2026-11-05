import { z } from 'zod';
import { objectId } from './common';

const optionIn = z.object({ text: z.string().trim().min(1).max(500), isCorrect: z.boolean() });
const imageUrl = z.string().max(500).refine((v) => /^https?:\/\//i.test(v), 'Image must be a web address starting with http(s)://');

const common = {
  id: objectId.optional(), // lets an edit keep a question's identity; unknown ids are replaced
  text: z.string().trim().min(1, 'Write the question').max(5000),
  points: z.number().min(0.25).max(100),
  topic: z.string().trim().max(80).optional(),
  explanation: z.string().trim().max(3000).optional(),
  image: imageUrl.optional(),
};

/** One question as sent by the exam/assignment editors. The same shape is used for both. */
export const questionInput = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('multiple_choice'), options: z.array(optionIn).min(2).max(8), ...common }),
    z.object({ type: z.literal('multiple_select'), options: z.array(optionIn).min(2).max(8), ...common }),
    z.object({ type: z.literal('true_false'), correctAnswer: z.boolean(), ...common }),
    z.object({ type: z.literal('short_answer'), acceptedAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(10), caseSensitive: z.boolean().default(false), ...common }),
    z.object({ type: z.literal('essay'), ...common }),
  ])
  .superRefine((q, ctx) => {
    if (q.type !== 'multiple_choice' && q.type !== 'multiple_select') return;
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.type === 'multiple_choice' && correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Select exactly one correct option' });
    if (q.type === 'multiple_select' && correct < 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Select at least one correct option' });
    const texts = q.options.map((o) => o.text.toLowerCase());
    if (new Set(texts).size !== texts.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must be different from each other' });
  });
export type QuestionInput = z.infer<typeof questionInput>;
