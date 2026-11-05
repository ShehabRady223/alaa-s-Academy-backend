import { Types } from 'mongoose';
import { AttemptAnswer } from '../types/attempt';
import { StoredQuestion } from '../types/exam';

export interface GradeResult { isCorrect: boolean | null; points: number; needsReview: boolean }

const norm = (s: string, cs: boolean) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return cs ? t : t.toLocaleLowerCase();
};

/** Pure, server-side. Multiple select is all-or-nothing. Essays wait for the teacher. */
export function gradeAnswer(q: StoredQuestion, response: unknown): GradeResult {
  const blank = response == null || response === '' || (Array.isArray(response) && response.length === 0);
  if (blank) return { isCorrect: false, points: 0, needsReview: false };

  switch (q.type) {
    case 'multiple_choice':
    case 'true_false': {
      const ok = typeof response === 'string' && q.correctOptionIds.length === 1 && response === q.correctOptionIds[0];
      return { isCorrect: ok, points: ok ? q.points : 0, needsReview: false };
    }
    case 'multiple_select': {
      const given = new Set(Array.isArray(response) ? (response as string[]) : []);
      const correct = new Set(q.correctOptionIds);
      const ok = given.size === correct.size && [...given].every((x) => correct.has(x));
      return { isCorrect: ok, points: ok ? q.points : 0, needsReview: false };
    }
    case 'short_answer': {
      const ok =
        typeof response === 'string' &&
        q.acceptedAnswers.some((a) => norm(a, q.caseSensitive) === norm(response, q.caseSensitive));
      return { isCorrect: ok, points: ok ? q.points : 0, needsReview: false };
    }
    case 'essay':
      return { isCorrect: null, points: 0, needsReview: true };
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function gradeAttempt(
  questions: StoredQuestion[],
  order: Types.ObjectId[],
  given: Map<string, AttemptAnswer>,
  subject = 'General',
) {
  const byId = new Map(questions.map((s) => [String(s.questionId), s]));
  let score = 0;
  let maxScore = 0;
  let needsReview = false;

  const answers: AttemptAnswer[] = order.flatMap((qid) => {
    const q = byId.get(String(qid));
    if (!q) return [];
    const a = given.get(String(qid));
    const g = gradeAnswer(q, a?.response ?? null);
    score += g.points;
    maxScore += q.points;
    needsReview ||= g.needsReview;
    return [{
      questionId: q.questionId, type: q.type, response: a?.response ?? null, timeSpentSec: a?.timeSpentSec ?? 0,
      isCorrect: g.isCorrect, pointsAwarded: g.points, maxPoints: q.points, needsReview: g.needsReview, reviewed: false,
      subjectName: subject, topicName: q.topic || 'General',
    }];
  });
  return { answers, score: round2(score), maxScore: round2(maxScore), needsReview };
}
