import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'academy' }, // single-document collection
    academyName: { type: String, default: "Alaa's Academy", maxlength: 120 },
    contactEmail: { type: String, maxlength: 200 },
    defaultPassingScore: { type: Number, default: 50, min: 0, max: 100 },
    defaultMaxAttempts: { type: Number, default: 1, min: 1, max: 10 },
  },
  { timestamps: true },
);
export const Setting = model('Setting', schema);
