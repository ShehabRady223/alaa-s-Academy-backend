import { ExamLean, StoredQuestion } from '../types/exam';
import { effectiveStatus } from './examStatus';

/** Teacher view of a question: includes the answers. */
export function adminQuestionView(q: StoredQuestion) {
  return {
    id: String(q.questionId), type: q.type, text: q.text, options: q.options, correctOptionIds: q.correctOptionIds, acceptedAnswers: q.acceptedAnswers,
    caseSensitive: q.caseSensitive, points: q.points, topic: q.topic ?? null, explanation: q.explanation ?? null, image: q.image ?? null,
  };
}

/**
 * The ONLY shape a student may ever receive for a question while it is open.
 * No correctOptionIds, acceptedAnswers or explanation. Used by the attempt engine and by homework.
 */
export function toStudentQuestion(q: StoredQuestion) {
  return { questionId: String(q.questionId), type: q.type, text: q.text, options: q.options.map((o) => ({ id: o.id, text: o.text })), points: q.points, image: q.image ?? null };
}

export function examSummary(e: ExamLean) {
  return {
    id: String(e._id), title: e.title, subject: e.subject, description: e.description ?? null, instructions: e.instructions ?? null,
    status: e.status, effectiveStatus: effectiveStatus(e), durationMinutes: e.durationMinutes ?? null, passingScore: e.passingScore, maxAttempts: e.maxAttempts,
    startDate: e.startDate ?? null, expiresAt: e.expiresAt ?? null, settings: e.settings, questionCount: e.questionCount ?? 0, totalPoints: e.totalPoints ?? 0,
    publishedAt: e.publishedAt ?? null, createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}
