import { Schema } from 'mongoose';
import { QUESTION_TYPES } from '../types/exam';

const optionSchema = new Schema({ id: { type: String, required: true }, text: { type: String, required: true, maxlength: 500 } }, { _id: false });

/** One question, stored inside the exam/assignment that owns it. Shared shape, so both features behave the same. */
export const questionSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    text: { type: String, required: true, maxlength: 5000 },
    options: { type: [optionSchema], default: [] },
    correctOptionIds: { type: [String], default: [] },
    acceptedAnswers: { type: [String], default: [] },
    caseSensitive: { type: Boolean, default: false },
    points: { type: Number, required: true, min: 0.25, max: 100 },
    topic: { type: String, trim: true, maxlength: 80 },
    explanation: { type: String, maxlength: 3000 },
    image: { type: String, maxlength: 500 },
  },
  { _id: false },
);
