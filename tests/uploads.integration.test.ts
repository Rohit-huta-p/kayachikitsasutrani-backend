import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/lib/password.js';
import { signSession } from '../src/lib/jwt.js';

let mongod: MongoMemoryServer;
let app: ReturnType<typeof buildApp>;
let adminCookie: string;
let studentCookie: string;

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

beforeEach(async () => {
  await User.deleteMany({});
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
  adminCookie = `sht_session=${signSession(admin._id.toString(), 'a'.repeat(32))}`;
  studentCookie = `sht_session=${signSession(student._id.toString(), 'a'.repeat(32))}`;
});

describe('POST /api/admin/uploads/audio', () => {
  it('admin uploads mp3 → 200 with url + publicId', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/audio')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('fake mp3 bytes'), { filename: 'a.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('res.cloudinary.com');
    expect(res.body.publicId).toContain('shlokas/audio/');
    expect(res.body.duration).toBe(12.3);
  });

  it('student → 403', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/audio')
      .set('Cookie', studentCookie)
      .attach('file', Buffer.from('x'), { filename: 'a.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(403);
  });

  it('unauth → 401', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/audio')
      .attach('file', Buffer.from('x'), { filename: 'a.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(401);
  });

  it('wrong mime → 415', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/audio')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('missing file field → 400', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/audio')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FILE');
  });

  it('over size limit → 413', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024);
    const res = await request(app)
      .post('/api/admin/uploads/audio')
      .set('Cookie', adminCookie)
      .attach('file', big, { filename: 'a.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});

describe('POST /api/admin/uploads/image', () => {
  it('admin uploads png → 200 with width + height', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/image')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('fake png'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('res.cloudinary.com');
    expect(res.body.publicId).toContain('shlokas/images/');
    expect(res.body.width).toBe(800);
    expect(res.body.height).toBe(600);
  });

  it('wrong mime → 415', async () => {
    const res = await request(app)
      .post('/api/admin/uploads/image')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('x'), { filename: 'x.gif', contentType: 'image/gif' });
    expect(res.status).toBe(415);
  });
});
