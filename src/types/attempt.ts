import { Types } from 'mongoose';
import { QuestionType } from './exam';

export const ATTEMPT_STATUSES = ['in_progress', 'pending_review', 'graded', 'voided'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export interface AttemptAnswer {
  questionId: Types.ObjectId;
  response: unknown; // string | string[] | null
  timeSpentSec?: number;
  savedAt?: Date;
  // filled at grading; denormalised so analytics are single aggregations
  type?: QuestionType;
  isCorrect?: boolean | null;
  pointsAwarded?: number;
  maxPoints?: number;
  needsReview?: boolean;
  reviewed?: boolean;
  feedback?: string | null;
  subjectName?: string;
  topicName?: string;
}

export interface AttemptLean {
  _id: Types.ObjectId;
  accessId: Types.ObjectId;
  teacherId: Types.ObjectId;
  studentId: Types.ObjectId;
  examId: Types.ObjectId;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: Date;
  deadline?: Date | null;
  layout: { questionId: Types.ObjectId; optionOrder: string[] }[];
  answers: AttemptAnswer[];
  score?: number | null;
  maxScore: number;
  percentage?: number | null;
  passed?: boolean | null;
  submittedAt?: Date | null;
  gradedAt?: Date | null;
  releasedAt?: Date | null;
  gradedBy?: Types.ObjectId | null;
  timeTakenSec?: number | null;
}

export interface ExamAccessLean {
  _id: Types.ObjectId;
  teacherId: Types.ObjectId;
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  expiresAt?: Date | null;
  maxAttempts: number;
  status: 'active' | 'revoked' | 'completed';
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
