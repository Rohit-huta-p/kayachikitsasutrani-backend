import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';
import { Shloka } from '../src/models/Shloka.js';
import { ShlokaCompletion } from '../src/models/ShlokaCompletion.js';
import { ActivityBucket } from '../src/models/ActivityBucket.js';
import { ActivitySession } from '../src/models/ActivitySession.js';
import { signSession } from '../src/lib/jwt.js';
import { addDays, dayInZone } from '../src/lib/analyticsDays.js';

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

const TZ = 'Asia/Kolkata';
const DAY_MS = 86_400_000;

function cookieFor(userId: string): string {
  return `sht_session=${signSession(userId, 'a'.repeat(32))}`;
}

let adminCookie: string;
let student: InstanceType<typeof User>;
let other: InstanceType<typeof User>;
let s1: InstanceType<typeof Shloka>;
let s2: InstanceType<typeof Shloka>;

async function seedShloka(slug: string, status: 'draft' | 'published', createdBy: mongoose.Types.ObjectId) {
  return Shloka.create({
    slug,
    title: `Title ${slug}`,
    meaning: 'm',
    status,
    audio: { full: { url: 'u', publicId: 'p' }, lines: [] },
    lines: [{ sanskrit: 'a', fullTimings: [{ text: 'a', start: 0, end: 1 }] }],
    createdBy,
  });
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Shloka.deleteMany({}),
    ShlokaCompletion.deleteMany({}),
    ActivityBucket.deleteMany({}),
    ActivitySession.deleteMany({}),
  ]);
  const admin = await User.create({ email: 'admin@x.test', passwordHash: 'x', role: 'admin', name: 'Admin' });
  adminCookie = cookieFor(admin._id.toString());
  student = await User.create({
    email: 'asha@x.test',
    passwordHash: 'x',
    role: 'student',
    name: 'Asha',
    lastLoginAt: new Date(),
  });
  other = await User.create({ email: 'ravi@x.test', passwordHash: 'x', role: 'student', name: 'Ravi' });
  s1 = await seedShloka('s1', 'published', admin._id);
  s2 = await seedShloka('s2', 'published', admin._id);
  await seedShloka('s3', 'published', admin._id);
  await seedShloka('s4-draft', 'draft', admin._id);

  const today = dayInZone(new Date(), TZ);
  await ActivityBucket.create([
    {
      userId: student._id, day: today, hour: 9, shlokaId: s1._id,
      totalSeconds: 900, listeningSeconds: 600, readingSeconds: 300, audioPlays: 2, audioCompletes: 1,
    },
    { userId: student._id, day: today, hour: 21, shlokaId: null, totalSeconds: 120, browsingSeconds: 120 },
    {
      userId: student._id, day: addDays(today, -1), hour: 9, shlokaId: s2._id,
      totalSeconds: 300, typingSeconds: 200, arrangingSeconds: 100,
      typeChecks: 3, typeBestPct: 75, arrangeChecks: 2, arrangeSolves: 1,
    },
    // Below the one-minute threshold: counts as time, not as an active day.
    { userId: student._id, day: addDays(today, -3), hour: 7, shlokaId: null, totalSeconds: 30, browsingSeconds: 30 },
    // Outside the 30-day range, inside the previous 30 days.
    { userId: student._id, day: addDays(today, -40), hour: 18, shlokaId: s1._id, totalSeconds: 500, readingSeconds: 500 },
  ]);

  const now = Date.now();
  await ActivitySession.create([
    { userId: student._id, sessionId: 'sess-mobile-1', device: 'mobile', startedAt: new Date(now - 3600_000), lastSeenAt: new Date(now), totalSeconds: 1000 },
    { userId: student._id, sessionId: 'sess-mobile-2', device: 'mobile', startedAt: new Date(now - DAY_MS), lastSeenAt: new Date(now - DAY_MS + 600_000), totalSeconds: 320 },
    { userId: student._id, sessionId: 'sess-desk-old', device: 'desktop', startedAt: new Date(now - 45 * DAY_MS), lastSeenAt: new Date(now - 45 * DAY_MS), totalSeconds: 500 },
  ]);

  // Ravi completed s1 first, faster and in fewer attempts → Asha ranks 2nd.
  await ShlokaCompletion.create([
    { userId: other._id, shlokaId: s1._id, completedAt: new Date(now - 5 * DAY_MS), attempts: 1, elapsedSeconds: 200 },
    { userId: student._id, shlokaId: s1._id, completedAt: new Date(now - 2 * DAY_MS), attempts: 2, elapsedSeconds: 400 },
  ]);
});

describe('GET /api/admin/analytics/students/:id', () => {
  it('unauth → 401, student → 403', async () => {
    expect((await request(app).get(`/api/admin/analytics/students/${student._id}`)).status).toBe(401);
    const res = await request(app)
      .get(`/api/admin/analytics/students/${student._id}`)
      .set('Cookie', cookieFor(student._id.toString()));
    expect(res.status).toBe(403);
  });

  it('unknown id → 404', async () => {
    const res = await request(app).get('/api/admin/analytics/students/507f1f77bcf86cd799439011').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('rejects ranges other than 7/30/90', async () => {
    const res = await request(app).get(`/api/admin/analytics/students/${student._id}?days=5`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('summarises time, habits, practice and per-shloka progress', async () => {
    const res = await request(app)
      .get(`/api/admin/analytics/students/${student._id}?days=30&tz=${encodeURIComponent(TZ)}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const body = res.body;
    const today = dayInZone(new Date(), TZ);

    expect(body.tz).toBe(TZ);
    expect(body.range).toEqual({ days: 30, from: addDays(today, -29), to: today, prevFrom: addDays(today, -59) });
    expect(body.trackingSince).toBe(addDays(today, -40));
    expect(body.user.email).toBe('asha@x.test');
    expect(body.user.lastLoginAt).toEqual(expect.any(String));

    expect(body.summary).toMatchObject({
      totalSeconds: 1850,
      rangeSeconds: 1350,
      prevRangeSeconds: 500,
      activeDays: 2,
      currentStreak: 2,
      longestStreak: 2,
      sessions: 3,
      rangeSessions: 2,
      avgSessionSeconds: 660,
      completed: 1,
      inProgress: 1,
      available: 3,
      devices: { mobile: 1320, tablet: 0, desktop: 0 },
    });

    expect(body.daily).toHaveLength(30);
    expect(body.daily[29]).toEqual({ day: today, seconds: 1020 });
    expect(body.daily[28]).toEqual({ day: addDays(today, -1), seconds: 300 });
    expect(body.hourly[9]).toBe(1200);
    expect(body.hourly[21]).toBe(120);
    expect(body.hourly[7]).toBe(30);
    expect(body.hourly[18]).toBe(0); // the 40-day-old bucket is out of range
    expect(body.weekday.reduce((a: number, b: number) => a + b, 0)).toBe(1350);

    expect(body.activity).toEqual({ listening: 600, reading: 300, typing: 200, drawing: 0, arranging: 100, browsing: 150 });
    expect(body.actions).toEqual({
      audioPlays: 2, audioCompletes: 1, meaningPlays: 0, typeChecks: 3, arrangeChecks: 2, arrangeSolves: 1,
    });

    expect(body.shlokas.map((r: { slug: string; status: string }) => [r.slug, r.status])).toEqual([
      ['s2', 'in-progress'],
      ['s1', 'completed'],
      ['s3', 'not-started'],
    ]);
    const [row2, row1, row3] = body.shlokas;
    expect(row2).toMatchObject({ totalSeconds: 300, practiceSeconds: 300, typeBestPct: 75, arrangeSolves: 1, completion: null });
    expect(row1).toMatchObject({ totalSeconds: 1400, listeningSeconds: 600, readingSeconds: 800, audioCompletes: 1 });
    expect(row1.completion).toMatchObject({ attempts: 2, elapsedSeconds: 400, rank: 2, totalCompletions: 2 });
    expect(row3).toMatchObject({ totalSeconds: 0, lastActiveAt: null, available: true });
  });

  it('keeps time on shlokas that later left the student catalog', async () => {
    await User.updateOne({ _id: student._id }, { $set: { allowedShlokas: [s1._id] } });
    const res = await request(app).get(`/api/admin/analytics/students/${student._id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.available).toBe(1);
    expect(res.body.summary.inProgress).toBe(0);
    const row2 = res.body.shlokas.find((r: { slug: string }) => r.slug === 's2');
    expect(row2).toMatchObject({ available: false, status: 'in-progress', totalSeconds: 300 });
  });

  it('student with no tracked activity gets zeroed analytics', async () => {
    const res = await request(app).get(`/api/admin/analytics/students/${other._id}?days=7`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ totalSeconds: 0, sessions: 0, activeDays: 0, completed: 1, lastActiveAt: null });
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.daily.every((d: { seconds: number }) => d.seconds === 0)).toBe(true);
  });
});

describe('GET /api/admin/analytics/students', () => {
  it('returns headline numbers per student', async () => {
    const res = await request(app).get(`/api/admin/analytics/students?tz=${encodeURIComponent(TZ)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.items.map((r: { userId: string }) => [r.userId, r]));
    expect(byId.get(student._id.toString())).toMatchObject({
      totalSeconds: 1850,
      last7Seconds: 1350,
      completed: 1,
      lastActiveAt: expect.any(String),
    });
    expect(byId.get(other._id.toString())).toMatchObject({ totalSeconds: 0, completed: 1, lastActiveAt: null });
  });

  it('student → 403', async () => {
    const res = await request(app).get('/api/admin/analytics/students').set('Cookie', cookieFor(student._id.toString()));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/students/:id', () => {
  it('removes the student activity too', async () => {
    const res = await request(app).delete(`/api/admin/students/${student._id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(await ActivityBucket.countDocuments({ userId: student._id })).toBe(0);
    expect(await ActivitySession.countDocuments({ userId: student._id })).toBe(0);
  });
});
