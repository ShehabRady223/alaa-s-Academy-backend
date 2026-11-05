import { Schema, model } from 'mongoose';

export const SUBMISSION_STATUSES = ['draft', 'submitted', 'graded'] as const;

const schema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    answers: { type: [new Schema({ questionId: { type: Schema.Types.ObjectId, required: true }, response: { type: Schema.Types.Mixed, default: null } }, { _id: false, minimize: false })], default: [] },
    status: { type: String, enum: SUBMISSION_STATUSES, default: 'draft' },
    submittedAt: { type: Date },
    late: { type: Boolean, default: false },
    // one entry per question once submitted: auto-graded types are filled in by the server, essays wait for the teacher
    grades: { type: [new Schema({ questionId: { type: Schema.Types.ObjectId, required: true }, points: { type: Number, required: true, min: 0 }, isCorrect: { type: Boolean, default: null }, needsReview: { type: Boolean, default: false }, feedback: { type: String, maxlength: 2000 } }, { _id: false })], default: [] },
    score: { type: Number },
    maxScore: { type: Number },
    feedback: { type: String, maxlength: 2000 },
    gradedAt: { type: Date },
  },
  { timestamps: true },
);
schema.index({ assignmentId: 1, studentId: 1 }, { unique: true }); // one submission per student per assignment
schema.index({ studentId: 1, updatedAt: -1 });

export const AssignmentSubmission = model('AssignmentSubmission', schema);
