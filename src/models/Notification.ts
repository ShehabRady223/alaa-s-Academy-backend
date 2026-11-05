import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true }, // attempt_completed | manual_grading | exam_expiring
    title: { type: String, required: true },
    body: { type: String },
    entityType: { type: String },
    entityId: { type: Schema.Types.ObjectId },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ userId: 1, readAt: 1, createdAt: -1 });

export const Notification = model('Notification', schema);
