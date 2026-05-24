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
  adminId = admin._id.toString();
  adminCookie = `sht_session=${signSession(admin._id.toString(), 'a'.repeat(32))}`;
  studentCookie = `sht_session=${signSession(student._id.toString(), 'a'.repeat(32))}`;
});

describe('GET /api/admin/students', () => {
  it('unauth → 401', async () => {
    const res = await request(app).get('/api/admin/students');
    expect(res.status).toBe(401);
  });

  it('student → 403', async () => {
    const res = await request(app).get('/api/admin/students').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
  });

  it('admin → lists students only (no admins)', async () => {
    const res = await request(app).get('/api/admin/students').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].email).toBe('student@x.test');
    expect(res.body.items[0].role).toBe('student');
  });

  it('pagination cursor works', async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await User.create({
        email: `s${i}@x.test`,
        passwordHash: await hashPassword('password1'),
        role: 'student',
        name: `S${i}`,
      });
    }
    const first = await request(app).get('/api/admin/students?limit=2').set('Cookie', adminCookie);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeDefined();
    const second = await request(app)
      .get(`/api/admin/students?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', adminCookie);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.items[0].email).not.toBe(first.body.items[0].email);
  });
});

describe('GET /api/admin/students/:id', () => {
  it('admin gets existing student → 200', async () => {
    const stu = await User.findOne({ email: 'student@x.test' });
    const res = await request(app).get(`/api/admin/students/${stu!._id.toString()}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('student@x.test');
  });

  it('unknown id → 404', async () => {
    const res = await request(app).get('/api/admin/students/507f1f77bcf86cd799439011').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('admin user id → 404 (not in students list)', async () => {
    const res = await request(app).get(`/api/admin/students/${adminId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
