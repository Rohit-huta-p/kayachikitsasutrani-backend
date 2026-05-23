import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../src/models/User.js';
import { seedAdmin } from '../src/scripts/seedAdmin.js';
import { comparePassword } from '../src/lib/password.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

describe('seedAdmin', () => {
  it('creates an admin when none exists', async () => {
    await seedAdmin({ email: 'admin@x.test', password: 'strongpw1', name: 'Admin One' });
    const doc = await User.findOne({ email: 'admin@x.test' });
    expect(doc).not.toBeNull();
    expect(doc!.role).toBe('admin');
    expect(doc!.name).toBe('Admin One');
    expect(await comparePassword('strongpw1', doc!.passwordHash)).toBe(true);
  });

  it('updates password + ensures admin role when user already exists', async () => {
    await seedAdmin({ email: 'admin@x.test', password: 'firstpw1', name: 'Admin One' });
    await seedAdmin({ email: 'admin@x.test', password: 'secondpw2', name: 'Admin Two' });
    const docs = await User.find({ email: 'admin@x.test' });
    expect(docs).toHaveLength(1);
    expect(docs[0].role).toBe('admin');
    expect(docs[0].name).toBe('Admin Two');
    expect(await comparePassword('secondpw2', docs[0].passwordHash)).toBe(true);
  });

  it('promotes an existing student to admin', async () => {
    await User.create({
      email: 'someone@x.test',
      passwordHash: 'irrelevant',
      role: 'student',
      name: 'Was Student',
    });
    await seedAdmin({ email: 'someone@x.test', password: 'newpass12', name: 'Now Admin' });
    const doc = await User.findOne({ email: 'someone@x.test' });
    expect(doc!.role).toBe('admin');
  });
});
