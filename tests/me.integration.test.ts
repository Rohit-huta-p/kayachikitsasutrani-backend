import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';
import { Shloka } from '../src/models/Shloka.js';
import { ShlokaCompletion } from '../src/models/ShlokaCompletion.js';
import { hashPassword } from '../src/lib/password.js';
import { signSession } from '../src/lib/jwt.js';

let mongod: MongoMemoryServer;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.MONGO_URI = mongod.getUri();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'strongpw1';
  process.env.ADMIN_NAME = 'Admin';
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = '123';
  process.env.CLOUDINARY_API_SECRET = 'sssss';
  await mongoose.connect(mongod.getUri());
  app = buildApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function seedShloka(slug: string) {
  const u = await User.create({
    email: `creator-${slug}@x.test`,
    passwordHash: 'x',
    role: 'admin',
    name: 'Creator',
  });
  return Shloka.create({
    slug,
    title: `Title ${slug}`,
    meaning: 'm',
    translation: 't',
    status: 'published',
    audio: { full: { url: 'u', publicId: 'p' }, lines: [{ url: 'u', publicId: 'p1' }] },
    lines: [{
      sanskrit: 'a',
      words: [{ text: 'a', start: 0, end: 1 }],
      fullTimings: [{ text: 'a', start: 0, end: 1 }],
    }],
    createdBy: u._id,
  });
}

async function seedStudent(email: string, name: string) {
  return User.create({
    email,
    passwordHash: await hashPassword('password1'),
    role: 'student',
    name,
  });
}

function cookieFor(userId: string): string {
  return `sht_session=${signSession(userId, 'a'.repeat(32))}`;
}

beforeEach(async () => {
  await ShlokaCompletion.deleteMany({});
  await Shloka.deleteMany({});
  await User.deleteMany({});
});

describe('GET /api/me/completions', () => {
  it('returns empty list when user has no completions', async () => {
    const student = await seedStudent('a@x.test', 'Aakash');
    const res = await request(app).get('/api/me/completions')
      .set('Cookie', cookieFor(student._id.toString()));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('returns user completions sorted by completedAt DESC with per-shloka rank', async () => {
    const sh1 = await seedShloka('s1');
    const sh2 = await seedShloka('s2');
    const me = await seedStudent('me@x.test', 'Me');
    const other = await seedStudent('other@x.test', 'Other');
    await ShlokaCompletion.create({ userId: other._id, shlokaId: sh1._id, completedAt: new Date('2026-05-25T10:00:00Z'), attempts: 1, elapsedSeconds: 30 });
    await ShlokaCompletion.create({ userId: me._id,    shlokaId: sh1._id, completedAt: new Date('2026-05-25T11:00:00Z'), attempts: 1, elapsedSeconds: 60 });
    await ShlokaCompletion.create({ userId: me._id,    shlokaId: sh2._id, completedAt: new Date('2026-05-26T10:00:00Z'), attempts: 2, elapsedSeconds: 80 });

    const res = await request(app).get('/api/me/completions')
      .set('Cookie', cookieFor(me._id.toString()));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].slug).toBe('s2');
    expect(res.body.items[0].rank).toBe(1);
    expect(res.body.items[0].totalCompletions).toBe(1);
    expect(res.body.items[0].title).toBe('Title s2');
    expect(res.body.items[1].slug).toBe('s1');
    expect(res.body.items[1].rank).toBe(2);
    expect(res.body.items[1].totalCompletions).toBe(2);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/me/completions');
    expect(res.status).toBe(401);
  });

  it('still returns completion when shloka was later moved to draft', async () => {
    const sh = await seedShloka('s1');
    const me = await seedStudent('me@x.test', 'Me');
    await ShlokaCompletion.create({ userId: me._id, shlokaId: sh._id, completedAt: new Date(), attempts: 1, elapsedSeconds: 30 });
    sh.status = 'draft';
    await sh.save();
    const res = await request(app).get('/api/me/completions')
      .set('Cookie', cookieFor(me._id.toString()));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].slug).toBe('s1');
  });
});
