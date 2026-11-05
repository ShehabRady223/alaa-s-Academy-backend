import { Types } from 'mongoose';

export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'multiple_select', 'short_answer', 'essay'] as const;
export const EXAM_STATUSES = ['draft', 'published', 'archived'] as const;
export const RESULT_RELEASE = ['instant', 'manual'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type ExamStatus = (typeof EXAM_STATUSES)[number];
export interface Option { id: string; text: string }

/** Everything that defines how a question looks and is graded. */
export interface QuestionContent {
  type: QuestionType;
  text: string;
  options: Option[];
  correctOptionIds: string[]; // choice types
  acceptedAnswers: string[]; // short_answer
  caseSensitive: boolean;
  explanation?: string | null;
  image?: string | null;
}

/** A question stored INSIDE an exam or an assignment. There is no shared question bank. Contains answers: server-side only. */
export interface StoredQuestion extends QuestionContent {
  questionId: Types.ObjectId;
  points: number;
  topic?: string | null; // optional free-text label, used only to group progress reports
}

export interface ExamSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  resultRelease: (typeof RESULT_RELEASE)[number];
  showCorrectAnswers: boolean;
}

export interface ExamLean {
  _id: Types.ObjectId;
  title: string;
  subject: string;
  description?: string | null;
  instructions?: string | null;
  durationMinutes?: number | null;
  passingScore: number;
  maxAttempts: number;
  startDate?: Date | null;
  expiresAt?: Date | null;
  settings: ExamSettings;
  questionCount: number;
  totalPoints: number;
  status: ExamStatus;
  publishedAt?: Date | null;
  teacherId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
