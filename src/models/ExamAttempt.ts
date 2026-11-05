import { Schema, model } from 'mongoose';
import { QUESTION_TYPES } from '../types/exam';
import { ATTEMPT_STATUSES } from '../types/attempt';

const answerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    response: { type: Schema.Types.Mixed, default: null },
    timeSpentSec: { type: Number, min: 0 },
    savedAt: { type: Date },
    type: { type: String, enum: QUESTION_TYPES },
    isCorrect: { type: Boolean, default: null },
    pointsAwarded: { type: Number },
    maxPoints: { type: Number },
    needsReview: { type: Boolean },
    reviewed: { type: Boolean },
    feedback: { type: String, maxlength: 2000 },
    subjectName: { type: String },
    topicName: { type: String },
  },
  { _id: false, minimize: false },
);

const schema = new Schema(
  {
    accessId: { type: Schema.Types.ObjectId, ref: 'ExamAccess', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // owner, for scoped result queries
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'in_progress' },
    startedAt: { type: Date, required: true },
    deadline: { type: Date, default: null }, // server-authoritative
    // Shuffle order is fixed at start so a refresh shows the same order.
    layout: [new Schema({ questionId: Schema.Types.ObjectId, optionOrder: [String] }, { _id: false })],
    answers: { type: [answerSchema], default: [] },
    score: { type: Number },
    maxScore: { type: Number, required: true },
    percentage: { type: Number },
    passed: { type: Boolean },
    submittedAt: { type: Date },
    gradedAt: { type: Date },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    releasedAt: { type: Date }, // result visible to the student once set
    timeTakenSec: { type: Number },
  },
  { timestamps: true },
);
// Stops two tabs creating the same attempt number (enforces maxAttempts under races).
schema.index({ accessId: 1, attemptNumber: 1 }, { unique: true });
// At most one in-progress attempt per exam access.
schema.index({ accessId: 1 }, { unique: true, partialFilterExpression: { status: 'in_progress' } });
schema.index({ studentId: 1, submittedAt: -1 });
schema.index({ teacherId: 1, status: 1, submittedAt: -1 }); // results list and dashboard
schema.index({ examId: 1, status: 1 }); // per-exam analytics

export const ExamAttempt = model('ExamAttempt', schema);
