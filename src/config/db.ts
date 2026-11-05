import mongoose from 'mongoose';
import { env } from './env';

// export async function connectDb(): Promise<void> {
//   mongoose.set('strictQuery', true);
//   await mongoose.connect(env.MONGO_URI);
//   console.log('MongoDB connected');
// }

let isConnected = false;

export async function connectDb(): Promise<void> {
  if (isConnected) {
    return;
  }
  try {
    const opts = {
      dbName: 'Exam'
    };
    await mongoose.connect(env.MONGO_URI, opts);
    isConnected = true;
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
};