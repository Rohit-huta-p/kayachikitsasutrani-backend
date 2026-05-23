import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { hashPassword } from '../lib/password.js';
import { env } from '../env.js';
import { connectDb, disconnectDb } from '../db.js';

export interface SeedAdminInput {
  email: string;
  password: string;
  name: string;
}

export async function seedAdmin(input: SeedAdminInput): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    existing.role = 'admin';
    existing.passwordHash = passwordHash;
    existing.name = input.name;
    await existing.save();
    console.log(`[seedAdmin] updated existing user ${input.email} → role=admin`);
    return;
  }
  await User.create({
    email: input.email.toLowerCase(),
    passwordHash,
    role: 'admin',
    name: input.name,
  });
  console.log(`[seedAdmin] created admin ${input.email}`);
}

async function main(): Promise<void> {
  const e = env();
  await connectDb(e.MONGO_URI);
  try {
    await seedAdmin({ email: e.ADMIN_EMAIL, password: e.ADMIN_PASSWORD, name: e.ADMIN_NAME });
  } finally {
    await disconnectDb();
    await mongoose.connection.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then(
    () => process.exit(0),
    err => {
      console.error('[seedAdmin] failed:', err);
      process.exit(1);
    },
  );
}
