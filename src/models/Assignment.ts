import { Schema, model } from 'mongoose';
import { questionSchema } from './embeddedQuestion';

export const ASSIGNMENT_STATUSES = ['draft', 'published', 'closed'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Homework sent to students. Has no reference to any Exam, ExamAccess or QR code. Its questions live inside it. */
const schema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    subject: { type: String, trim: true, maxlength: 80, default: 'General' },
    description: { type: String, maxlength: 2000 },
    instructions: { type: String, maxlength: 5000 },
    questions: { type: [questionSchema], default: [], select: false },
    questionCount: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    studentIds: { type: [Schema.Types.ObjectId], default: [] }, // recipients
    dueDate: { type: Date, default: null },
    allowLate: { type: Boolean, default: false },
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'draft' },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);
schema.index({ teacherId: 1, status: 1, updatedAt: -1 }); // teacher's list
schema.index({ studentIds: 1, status: 1 }); // a student's list (multikey)

export const Assignment = model('Assignment', schema);
