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

async function seedShloka(slug: string, status: 'draft' | 'published' = 'published') {
  const u = await User.create({
    email: `creator-${slug}@x.test`,
    passwordHash: 'x',
    role: 'admin',
    name: 'Creator',
  });
  return Shloka.create({
    slug,
    title: slug,
    meaning: 'm',
    translation: 't',
    status,
    audio: { full: { url: 'u', publicId: 'p' }, lines: [{ url: 'u', publicId: 'p1' }] },
    lines: [
      {
        sanskrit: 'a',
        words: [{ text: 'a', start: 0, end: 1 }],
        fullTimings: [{ text: 'a', start: 0, end: 1 }],
      },
    ],
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

describe('POST /api/shlokas/:slug/complete', () => {
  it('records first completion', async () => {
    const shloka = await seedShloka('s1');
    const student = await seedStudent('a@x.test', 'Aakash Raj');
    const res = await request(app)
      .post('/api/shlokas/s1/complete')
      .set('Cookie', cookieFor(student._id.toString()))
      .send({ attempts: 1, elapsedSeconds: 42 });
    expect(res.status).toBe(200);
    expect(res.body.alreadyCompleted).toBe(false);
    expect(res.body.completion.attempts).toBe(1);
    expect(res.body.completion.elapsedSeconds).toBe(42);
    const count = await ShlokaCompletion.countDocuments({});
    expect(count).toBe(1);
  });

  it('second POST returns existing, does not update', async () => {
    const shloka = await seedShloka('s1');
    const student = await seedStudent('a@x.test', 'A');
    await request(app).post('/api/shlokas/s1/complete')
      .set('Cookie', cookieFor(student._id.toString()))
      .send({ attempts: 1, elapsedSeconds: 42 });
    const res = await request(app).post('/api/shlokas/s1/complete')
      .set('Cookie', cookieFor(student._id.toString()))
      .send({ attempts: 99, elapsedSeconds: 999 });
    expect(res.status).toBe(200);
    expect(res.body.alreadyCompleted).toBe(true);
    expect(res.body.completion.attempts).toBe(1);
    expect(res.body.completion.elapsedSeconds).toBe(42);
  });

  it('unauth → 401', async () => {
    await seedShloka('s1');
    const res = await request(app).post('/api/shlokas/s1/complete').send({ attempts: 1, elapsedSeconds: 1 });
    expect(res.status).toBe(401);
  });

  it('unknown slug → 404', async () => {
    const student = await seedStudent('a@x.test', 'A');
    const res = await request(app).post('/api/shlokas/none/complete')
      .set('Cookie', cookieFor(student._id.toString()))
      .send({ attempts: 1, elapsedSeconds: 1 });
    expect(res.status).toBe(404);
  });

  it('draft shloka as student → 404', async () => {
    await seedShloka('draft1', 'draft');
    const student = await seedStudent('a@x.test', 'A');
    const res = await request(app).post('/api/shlokas/draft1/complete')
      .set('Cookie', cookieFor(student._id.toString()))
      .send({ attempts: 1, elapsedSeconds: 1 });
    expect(res.status).toBe(404);
  });

  it('invalid body → 400', async () => {
    await seedShloka('s1');
    const student = await seedStudent('a@x.test', 'A');
    const res = await request(app).post('/api/shlokas/s1/complete')
      .set('Cookie', cookieFor(student._id.toString()))
      .send({ attempts: 0, elapsedSeconds: -1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/shlokas/:slug/leaderboard', () => {
  it('empty when no completions', async () => {
    await seedShloka('s1');
    const student = await seedStudent('a@x.test', 'A');
    const res = await request(app).get('/api/shlokas/s1/leaderboard')
      .set('Cookie', cookieFor(student._id.toString()));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('ranks by averageRank with correct sub-ranks', async () => {
    const shloka = await seedShloka('s1');
    // Three students with different signatures:
    // A: 1st chrono, 2nd time, 3rd attempts → (1+2+3)/3 = 2
    // B: 2nd chrono, 1st time, 1st attempts → (2+1+1)/3 = 1.33
    // C: 3rd chrono, 3rd time, 2nd attempts → (3+3+2)/3 = 2.67
    // Expected order: B, A, C
    const a = await seedStudent('a@x.test', 'A');
    const b = await seedStudent('b@x.test', 'B');
    const c = await seedStudent('c@x.test', 'C');
    await ShlokaCompletion.create({ userId: a._id, shlokaId: shloka._id, completedAt: new Date('2026-05-25T10:00:00Z'), attempts: 5, elapsedSeconds: 100 });
    await ShlokaCompletion.create({ userId: b._id, shlokaId: shloka._id, completedAt: new Date('2026-05-25T11:00:00Z'), attempts: 1, elapsedSeconds: 50 });
    await ShlokaCompletion.create({ userId: c._id, shlokaId: shloka._id, completedAt: new Date('2026-05-25T12:00:00Z'), attempts: 3, elapsedSeconds: 150 });

    const viewer = await seedStudent('v@x.test', 'V');
    const res = await request(app).get('/api/shlokas/s1/leaderboard')
      .set('Cookie', cookieFor(viewer._id.toString()));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((it: { name: string }) => it.name)).toEqual(['B', 'A', 'C']);
    expect(res.body.items[0].timeRank).toBe(1);
    expect(res.body.items[0].attemptsRank).toBe(1);
    expect(res.body.items[0].chronoRank).toBe(2);
  });

  it('unauth → 401', async () => {
    await seedShloka('s1');
    const res = await request(app).get('/api/shlokas/s1/leaderboard');
    expect(res.status).toBe(401);
  });

  it('draft shloka as student → 404', async () => {
    await seedShloka('d1', 'draft');
    const student = await seedStudent('a@x.test', 'A');
    const res = await request(app).get('/api/shlokas/d1/leaderboard')
      .set('Cookie', cookieFor(student._id.toString()));
    expect(res.status).toBe(404);
  });
});
