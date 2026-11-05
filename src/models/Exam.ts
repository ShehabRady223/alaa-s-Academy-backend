import { Schema } from 'mongoose';
import { model } from 'mongoose';
import { EXAM_STATUSES, RESULT_RELEASE } from '../types/exam';
import { questionSchema } from './embeddedQuestion';

export const settingsSchema = new Schema(
  {
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },
    resultRelease: { type: String, enum: RESULT_RELEASE, default: 'instant' },
    showCorrectAnswers: { type: Boolean, default: true },
  },
  { _id: false },
);

const schema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    subject: { type: String, trim: true, maxlength: 80, default: 'General' }, // groups progress reports
    description: { type: String, maxlength: 2000 },
    instructions: { type: String, maxlength: 5000 },
    durationMinutes: { type: Number, min: 1, max: 600, default: null }, // null = untimed
    passingScore: { type: Number, min: 0, max: 100, default: 50 },
    maxAttempts: { type: Number, min: 1, max: 10, default: 1 },
    startDate: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    settings: { type: settingsSchema, default: () => ({}) },
    // The exam's own questions (no shared bank). select:false: never loaded by accident, e.g. into a student response.
    questions: { type: [questionSchema], default: [], select: false },
    questionCount: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    status: { type: String, enum: EXAM_STATUSES, default: 'draft' },
    publishedAt: { type: Date },
    expiryNotifiedAt: { type: Date }, // set once the "expiring soon" notification went out
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ teacherId: 1, status: 1, updatedAt: -1 });

export const Exam = model('Exam', schema);
