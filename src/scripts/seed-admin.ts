import argon2 from 'argon2';
import mongoose from 'mongoose';
import { connectDb } from '../config/db';
import { env } from '../config/env';
import { User } from '../models/User';

async function main() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  await connectDb();
  const email = env.ADMIN_EMAIL.toLowerCase();
  if (await User.exists({ email })) {
    console.log('Admin already exists, nothing to do.');
  } else {
    await User.create({
      name: env.ADMIN_NAME ?? 'Admin',
      email,
      role: 'admin',
      passwordHash: await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id }),
    });
    console.log(`Admin created: ${email}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
