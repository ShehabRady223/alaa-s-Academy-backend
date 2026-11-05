import { Schema, model } from 'mongoose';

export const ROLES = ['admin', 'student'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, required: true },
    avatar: { type: String },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
