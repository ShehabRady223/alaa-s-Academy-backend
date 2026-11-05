import { Schema, model } from 'mongoose';

export const STUDENT_STATUSES = ['invited', 'active', 'disabled'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // the teacher who owns this student
    phone: { type: String, trim: true, maxlength: 30 },
    dateOfBirth: { type: Date },
    notes: { type: String, maxlength: 2000 },
    level: { type: String, trim: true, maxlength: 60 },
    status: { type: String, enum: STUDENT_STATUSES, default: 'invited' },
    lastActiveAt: { type: Date },
  },
  { timestamps: true },
);

schema.index({ teacherId: 1, status: 1 });

export const StudentProfile = model('StudentProfile', schema);
