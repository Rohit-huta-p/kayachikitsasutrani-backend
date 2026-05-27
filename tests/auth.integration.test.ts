import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';

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

beforeEach(async () => {
  await User.deleteMany({});
});

function extractCookie(res: request.Response): string | undefined {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return undefined;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.find(c => c.startsWith('sht_session='));
}

const VALID_SIGNUP = {
  email: 'student@example.com',
  password: 'hunter2hunter',
  name: 'A Student',
  age: 22,
  gender: 'male',
  collegeName: 'Test U',
  course: 'BAMS',
};

describe('auth routes', () => {
  it('signup creates a student and sets session cookie', async () => {
    const res = await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('student@example.com');
    expect(res.body.user.role).toBe('student');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(extractCookie(res)).toBeDefined();
  });

  it('signup with existing email → 409 EMAIL_TAKEN', async () => {
    await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    const res = await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('signup with weak password → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...VALID_SIGNUP, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('login with correct creds returns user and sets cookie', async () => {
    await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_SIGNUP.email, password: VALID_SIGNUP.password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(VALID_SIGNUP.email);
    expect(extractCookie(res)).toBeDefined();
  });

  it('login with wrong password → 401 INVALID_CREDENTIALS', async () => {
    await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_SIGNUP.email, password: 'wrongwrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('login with unknown email → 401 INVALID_CREDENTIALS (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /me without cookie → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /me with valid cookie → 200 with user', async () => {
    const signup = await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    const cookie = extractCookie(signup)!;
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(VALID_SIGNUP.email);
  });

  it('logout clears cookie; subsequent /me is 401', async () => {
    const signup = await request(app).post('/api/auth/signup').send(VALID_SIGNUP);
    const cookie = extractCookie(signup)!;
    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);
    const cleared = extractCookie(logout);
    expect(cleared).toMatch(/sht_session=;/);
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('logout without cookie → 401', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});
