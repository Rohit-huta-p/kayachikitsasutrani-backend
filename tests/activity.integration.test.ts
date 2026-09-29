import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';
import { Shloka } from '../src/models/Shloka.js';
import { ActivityBucket } from '../src/models/ActivityBucket.js';
import { ActivitySession } from '../src/models/ActivitySession.js';
import { signSession } from '../src/lib/jwt.js';
import { addDays } from '../src/lib/analyticsDays.js';

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

const today = () => new Date().toISOString().slice(0, 10);

function cookieFor(userId: string): string {
  return `sht_session=${signSession(userId, 'a'.repeat(32))}`;
}

async function seedUser(role: 'student' | 'admin', email: string) {
  return User.create({ email, passwordHash: 'x', role, name: role });
}

async function seedShloka(slug: string, createdBy: mongoose.Types.ObjectId) {
  return Shloka.create({
    slug,
    title: `Title ${slug}`,
    meaning: 'm',
    status: 'published',
    audio: { full: { url: 'u', publicId: 'p' }, lines: [] },
    lines: [{ sanskrit: 'a', fullTimings: [{ text: 'a', start: 0, end: 1 }] }],
    createdBy,
  });
}

function flush(cookie: string, body: Record<string, unknown>) {
  return request(app).post('/api/activity').set('Cookie', cookie).send(body);
}

beforeEach(async () => {
  await ActivityBucket.deleteMany({});
  await ActivitySession.deleteMany({});
  await Shloka.deleteMany({});
  await User.deleteMany({});
});

describe('POST /api/activity', () => {
  it('unauth → 401', async () => {
    const res = await request(app).post('/api/activity').send({});
    expect(res.status).toBe(401);
  });

  it('admin flushes are accepted but not recorded', async () => {
    const admin = await seedUser('admin', 'admin@x.test');
    const res = await flush(cookieFor(admin._id.toString()), {
      sessionId: 'session-admin-1',
      device: 'desktop',
      entries: [{ day: today(), hour: 10, slug: null, seconds: { browsing: 20 } }],
    });
    expect(res.status).toBe(204);
    expect(await ActivityBucket.countDocuments({})).toBe(0);
    expect(await ActivitySession.countDocuments({})).toBe(0);
  });

  it('records per-shloka buckets and a session', async () => {
    const student = await seedUser('student', 's@x.test');
    const shloka = await seedShloka('jwara', student._id);
    const res = await flush(cookieFor(student._id.toString()), {
      sessionId: 'session-abc-123',
      device: 'mobile',
      entries: [
        {
          day: today(),
          hour: 9,
          slug: 'jwara',
          seconds: { listening: 12, reading: 5, typing: 3 },
          counts: { audioPlays: 1, typeChecks: 2 },
          typeBestPct: 60,
        },
        { day: today(), hour: 9, slug: null, seconds: { browsing: 4 } },
      ],
    });
    expect(res.status).toBe(204);

    const onShloka = await ActivityBucket.findOne({ userId: student._id, shlokaId: shloka._id }).lean();
    expect(onShloka).toMatchObject({
      day: today(),
      hour: 9,
      totalSeconds: 20,
      listeningSeconds: 12,
      readingSeconds: 5,
      typingSeconds: 3,
      audioPlays: 1,
      typeChecks: 2,
      typeBestPct: 60,
    });
    const offShloka = await ActivityBucket.findOne({ userId: student._id, shlokaId: null }).lean();
    expect(offShloka).toMatchObject({ totalSeconds: 4, browsingSeconds: 4 });

    const session = await ActivitySession.findOne({ userId: student._id }).lean();
    expect(session).toMatchObject({ sessionId: 'session-abc-123', device: 'mobile', totalSeconds: 24 });
  });

  it('accumulates into the same bucket and keeps the best typing score', async () => {
    const student = await seedUser('student', 's@x.test');
    await seedShloka('jwara', student._id);
    const cookie = cookieFor(student._id.toString());
    const entry = (reading: number, typeBestPct: number) => ({
      day: today(),
      hour: 9,
      slug: 'jwara',
      seconds: { reading },
      counts: { typeChecks: 1 },
      typeBestPct,
    });
    // Separate sessions so neither flush is clamped by the other.
    await flush(cookie, { sessionId: 'session-one-1', device: 'desktop', entries: [entry(10, 80)] });
    await flush(cookie, { sessionId: 'session-two-2', device: 'desktop', entries: [entry(6, 40)] });
    const buckets = await ActivityBucket.find({ userId: student._id }).lean();
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ totalSeconds: 16, readingSeconds: 16, typeChecks: 2, typeBestPct: 80 });
  });

  it('unknown slugs count as time outside any shloka', async () => {
    const student = await seedUser('student', 's@x.test');
    await flush(cookieFor(student._id.toString()), {
      sessionId: 'session-abc-123',
      device: 'desktop',
      entries: [{ day: today(), hour: 9, slug: 'no-such-shloka', seconds: { reading: 7 } }],
    });
    const bucket = await ActivityBucket.findOne({ userId: student._id }).lean();
    expect(bucket).toMatchObject({ shlokaId: null, totalSeconds: 7 });
  });

  it('clamps a new session to 5 minutes and later flushes to elapsed time', async () => {
    const student = await seedUser('student', 's@x.test');
    const cookie = cookieFor(student._id.toString());
    const entry = (browsing: number) => ({ day: today(), hour: 9, slug: null, seconds: { browsing } });

    await flush(cookie, { sessionId: 'session-abc-123', device: 'desktop', entries: [entry(3000)] });
    let session = await ActivitySession.findOne({ userId: student._id }).lean();
    expect(session!.totalSeconds).toBe(300);

    // Immediately after: only the ~15s slack is available, not the 60s claimed.
    await flush(cookie, { sessionId: 'session-abc-123', device: 'desktop', entries: [entry(60)] });
    session = await ActivitySession.findOne({ userId: student._id }).lean();
    expect(session!.totalSeconds).toBeGreaterThan(314);
    expect(session!.totalSeconds).toBeLessThan(317);
    const bucket = await ActivityBucket.findOne({ userId: student._id }).lean();
    expect(bucket!.totalSeconds).toBeCloseTo(session!.totalSeconds, 0);
  });

  it('drops entries dated outside the plausible window', async () => {
    const student = await seedUser('student', 's@x.test');
    const res = await flush(cookieFor(student._id.toString()), {
      sessionId: 'session-abc-123',
      device: 'desktop',
      entries: [
        { day: addDays(today(), -10), hour: 9, slug: null, seconds: { browsing: 30 } },
        { day: addDays(today(), 5), hour: 9, slug: null, seconds: { browsing: 30 } },
      ],
    });
    expect(res.status).toBe(204);
    expect(await ActivityBucket.countDocuments({})).toBe(0);
  });

  it('an empty flush records nothing, not even a session', async () => {
    const student = await seedUser('student', 's@x.test');
    const res = await flush(cookieFor(student._id.toString()), {
      sessionId: 'session-abc-123',
      device: 'desktop',
      entries: [{ day: today(), hour: 9, slug: null }],
    });
    expect(res.status).toBe(204);
    expect(await ActivityBucket.countDocuments({})).toBe(0);
    expect(await ActivitySession.countDocuments({})).toBe(0);
  });

  it('invalid body → 400', async () => {
    const student = await seedUser('student', 's@x.test');
    const res = await flush(cookieFor(student._id.toString()), {
      sessionId: 'x',
      device: 'fridge',
      entries: [{ day: 'yesterday', hour: 25, slug: null }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
