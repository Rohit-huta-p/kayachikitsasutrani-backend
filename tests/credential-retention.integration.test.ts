import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { buildApp } from '../src/server.js';
import { User } from '../src/models/User.js';
import { CredentialDelivery } from '../src/models/CredentialDelivery.js';
import { hashPassword } from '../src/lib/password.js';
import { signSession } from '../src/lib/jwt.js';

// Own file so CREDENTIAL_RETENTION (read through the cached env()) can differ
// from the main suite.
const ENC_KEY = Buffer.alloc(32, 5).toString('base64');
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
  process.env.CREDENTIAL_ENC_KEY = ENC_KEY;
  process.env.CREDENTIAL_RETENTION = 'until_first_login';
  await mongoose.connect(mongod.getUri());
  app = buildApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await CredentialDelivery.deleteMany({});
});

const cookie = (userId: string) => `sht_session=${signSession(userId, 'a'.repeat(32))}`;

describe('credential retention: until_first_login', () => {
  it('purges the stored credential on the student first login', async () => {
    const admin = await User.create({
      email: 'root@x.test',
      passwordHash: await hashPassword('password1'),
      role: 'admin',
      name: 'Root',
      status: 'active',
    });
    const adminCookie = cookie(admin._id.toString());
    const pending = await User.create({
      email: 'f@x.test',
      passwordHash: 'throwaway',
      role: 'student',
      name: 'First Fay',
      status: 'pending',
    });

    const acc = await request(app).post(`/api/admin/access-requests/${pending._id}/accept`).set('Cookie', adminCookie);
    const pw = acc.body.password as string;

    // Before first login: credential is present.
    let list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', adminCookie);
    expect(list.body.items).toHaveLength(1);

    // Student logs in for the first time.
    expect((await request(app).post('/api/auth/login').send({ email: 'f@x.test', password: pw })).status).toBe(200);

    // Credential is purged — the student stays listed with no stored password.
    list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', adminCookie);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].password).toBeNull();
  });
});
