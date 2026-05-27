import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';
import { Shloka } from '../src/models/Shloka.js';
import { hashPassword } from '../src/lib/password.js';
import { signSession } from '../src/lib/jwt.js';

let mongod: MongoMemoryServer;
let app: ReturnType<typeof buildApp>;
let adminCookie: string;
let studentCookie: string;
let adminId: string;

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

async function seedShloka(slug: string, status: 'draft' | 'published') {
  return Shloka.create({
    slug,
    title: 'T',
    meaning: 'M',
    translation: 'Tr',
    status,
    audio: {
      full: { url: 'u', publicId: 'p' },
      lines: [{ url: 'u', publicId: 'p1' }],
    },
    lines: [
      {
        sanskrit: 'a',
        words: [{ text: 'a', start: 0, end: 1 }],
        fullTimings: [{ text: 'a', start: 0, end: 1 }],
      },
    ],
    createdBy: new mongoose.Types.ObjectId(adminId),
  });
}

beforeEach(async () => {
  await User.deleteMany({});
  await Shloka.deleteMany({});
  const admin = await User.create({
    email: 'admin@x.test',
    passwordHash: await hashPassword('password1'),
    role: 'admin',
    name: 'Admin',
  });
  const student = await User.create({
    email: 'student@x.test',
    passwordHash: await hashPassword('password1'),
    role: 'student',
    name: 'Student',
  });
  adminId = admin._id.toString();
  adminCookie = `sht_session=${signSession(admin._id.toString(), 'a'.repeat(32))}`;
  studentCookie = `sht_session=${signSession(student._id.toString(), 'a'.repeat(32))}`;
});

describe('GET /api/shlokas', () => {
  it('unauth → 401', async () => {
    const res = await request(app).get('/api/shlokas');
    expect(res.status).toBe(401);
  });

  it('student → only published', async () => {
    await seedShloka('draft-one', 'draft');
    await seedShloka('pub-one', 'published');
    const res = await request(app).get('/api/shlokas').set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].slug).toBe('pub-one');
  });

  it('admin also only sees published on this endpoint', async () => {
    await seedShloka('draft-x', 'draft');
    await seedShloka('pub-x', 'published');
    const res = await request(app).get('/api/shlokas').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].slug).toBe('pub-x');
  });

  it('response items do not include publicId', async () => {
    await seedShloka('p', 'published');
    const res = await request(app).get('/api/shlokas').set('Cookie', studentCookie);
    expect(res.body.items[0].audio.full.publicId).toBeUndefined();
  });

  it('cursor pagination works', async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await seedShloka(`p-${i}`, 'published');
    }
    const first = await request(app).get('/api/shlokas?limit=2').set('Cookie', studentCookie);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeDefined();

    const second = await request(app)
      .get(`/api/shlokas?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', studentCookie);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.items[0].slug).not.toBe(first.body.items[0].slug);
  });
});

describe('GET /api/shlokas/:slug', () => {
  it('unauth → 401', async () => {
    const res = await request(app).get('/api/shlokas/anything');
    expect(res.status).toBe(401);
  });

  it('published slug → 200', async () => {
    await seedShloka('hello', 'published');
    const res = await request(app).get('/api/shlokas/hello').set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('hello');
  });

  it('draft slug returns 404 even for admin', async () => {
    await seedShloka('secret', 'draft');
    const res = await request(app).get('/api/shlokas/secret').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('unknown slug → 404', async () => {
    const res = await request(app).get('/api/shlokas/nope').set('Cookie', studentCookie);
    expect(res.status).toBe(404);
  });
});
