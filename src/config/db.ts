// import mongoose from 'mongoose';
import { env } from './env';

// export async function connectDb(): Promise<void> {
//   mongoose.set('strictQuery', true);
//   await mongoose.connect(env.MONGO_URI);
//   console.log('MongoDB connected');
// }

// let isConnected = false;

// export async function connectDb(): Promise<void> {
//   if (isConnected) {
//     return;
//   }
//   try {
//     const opts = {
//       dbName: 'Exam'
//     };
//     await mongoose.connect(env.MONGO_URI, opts);
//     isConnected = true;
//     console.log('MongoDB connected successfully');
//   } catch (error) {
//     console.error('MongoDB connection error:', error);
//     throw error;
//   }
// };


// import mongoose, { type Mongoose } from "mongoose";

// declare global {
//   var mongoose:
//     | {
//         conn: Mongoose | null;
//         promise: Promise<Mongoose> | null;
//       }
//     | undefined;
// }

// const MONGO_URI = env.MONGO_URI;

// if (!MONGO_URI) {
//   throw new Error("MONGO_URI is not defined");
// }

// const cached = global.mongoose ?? (global.mongoose = {
//   conn: null,
//   promise: null,
// });

// export async function connectDb() {
//   if (cached.conn) {
//     return cached.conn;
//   }

//   if (!cached.promise) {
//     cached.promise = mongoose.connect(MONGO_URI).then((mongoose) => {
//       return mongoose;
//     });
//   }

//   try {
//     cached.conn = await cached.promise;
//     return cached.conn;
//   } catch (error) {
//     cached.promise = null;
//     throw error;
//   }
// }

import mongoose from 'mongoose';

let isConnected = false;

export async function connectDb() {
  if (isConnected) return;
  try {
    await mongoose.connect(env.MONGO_URI);
    isConnected = true;
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}