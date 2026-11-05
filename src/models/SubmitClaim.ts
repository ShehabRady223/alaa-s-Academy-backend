import { Schema, model } from 'mongoose';

/**
 * Insert-only marker: "this student has submitted this assignment". The unique index makes the database itself guarantee that
 * two simultaneous submits cannot both go through, independently of how conditional updates behave under concurrency.
 */
const schema = new Schema({ assignmentId: { type: Schema.Types.ObjectId, required: true }, studentId: { type: Schema.Types.ObjectId, required: true } }, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

export const SubmitClaim = model('SubmitClaim', schema);
