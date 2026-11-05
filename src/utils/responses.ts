import { AppError } from './errors';
import { StoredQuestion } from '../types/exam';

export type Response = string | string[] | null;
const bad = (m: string) => new AppError(400, m, 'BAD_REQUEST');

/** Validates a student's response against the question's REAL options. Returns the cleaned value or null (blank). */
export function cleanResponse(q: StoredQuestion, r: unknown): Response {
  if (r == null || r === '' || (Array.isArray(r) && r.length === 0)) return null;
  const valid = new Set(q.options.map((o) => o.id));
  switch (q.type) {
    case 'multiple_choice':
    case 'true_false':
      if (typeof r !== 'string' || !valid.has(r)) throw bad('Invalid answer for a choice question');
      return r;
    case 'multiple_select':
      if (!Array.isArray(r) || !r.every((x) => typeof x === 'string' && valid.has(x))) throw bad('Invalid answer for a multiple-select question');
      return [...new Set(r as string[])];
    case 'short_answer':
      if (typeof r !== 'string') throw bad('Invalid answer');
      return r.slice(0, 500);
    case 'essay':
      if (typeof r !== 'string') throw bad('Invalid answer');
      return r.slice(0, 20000);
  }
}
