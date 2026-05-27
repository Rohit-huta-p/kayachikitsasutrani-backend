import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../env.js';
import { User } from '../models/User.js';

async function main() {
  const e = env();
  await mongoose.connect(e.MONGO_URI);
  console.log('Connected. Running backfill…');
  // Use raw driver (User.collection) instead of Mongoose's User.updateMany so the
  // $rename operator is allowed — Mongoose rejects $rename for fields not in the
  // current schema (universityName no longer exists on the model).
  const result = await User.collection.updateMany(
    { role: 'student' },
    {
      $rename: { universityName: 'collegeName' },
      $set: { course: '3rd Prof BAMS' },
    },
  );
  console.log(`Matched ${result.matchedCount} student docs, modified ${result.modifiedCount}.`);
  // Second pass: handle docs that NEVER had universityName (so $rename was a no-op) — already covered by $set above.
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
