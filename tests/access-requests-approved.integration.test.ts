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

const ENC_KEY = Buffer.alloc(32, 9).toString('base64');
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
  process.env.CREDENTIAL_RETENTION = 'until_removed';
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
  process.env.CREDENTIAL_ENC_KEY = ENC_KEY; // restore after the key-missing case
});

const cookie = (userId: string) => `sht_session=${signSession(userId, 'a'.repeat(32))}`;

async function seedAdmin() {
  const a = await User.create({
    email: 'root@x.test',
    passwordHash: await hashPassword('password1'),
    role: 'admin',
    name: 'Root',
    status: 'active',
  });
  return cookie(a._id.toString());
}

async function seedPending(email = 'p@x.test', name = 'Pending Pat') {
  return User.create({
    email,
    passwordHash: 'throwaway',
    role: 'student',
    name,
    status: 'pending',
    age: 22,
    collegeName: 'Govt Ayurveda',
    course: 'BAMS',
  });
}

describe('approved credential persistence', () => {
  it('accept stores a credential that /approved can reveal', async () => {
    const admin = await seedAdmin();
    const pending = await seedPending();
    const acc = await request(app).post(`/api/admin/access-requests/${pending._id}/accept`).set('Cookie', admin);
    expect(acc.status).toBe(200);
    const password = acc.body.password as string;
    expect(password).toHaveLength(14);

    const list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', admin);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const item = list.body.items[0];
    expect(item.id).toBe(pending._id.toString());
    expect(item.password).toBe(password);
    expect(item.collegeName).toBe('Govt Ayurveda');
    expect(item.mailto).toContain('mailto:');
  });

  it('/approved is admin-only', async () => {
    const student = await User.create({
      email: 's@x.test',
      passwordHash: await hashPassword('password1'),
      role: 'student',
      name: 'Stu',
      status: 'active',
    });
    expect((await request(app).get('/api/admin/access-requests/approved')).status).toBe(401);
    expect(
      (await request(app).get('/api/admin/access-requests/approved').set('Cookie', cookie(student._id.toString()))).status,
    ).toBe(403);
  });

  it('DELETE /approved/:id forgets the credential but keeps the user active', async () => {
    const admin = await seedAdmin();
    const pending = await seedPending();
    await request(app).post(`/api/admin/access-requests/${pending._id}/accept`).set('Cookie', admin);

    const del = await request(app).delete(`/api/admin/access-requests/approved/${pending._id}`).set('Cookie', admin);
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', admin);
    // Student stays an approved account, now with no stored password.
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].password).toBeNull();
    const user = await User.findById(pending._id).lean();
    expect(user?.status).toBe('active');
  });

  it('lists previously-approved students with no stored credential as password: null', async () => {
    const admin = await seedAdmin();
    // An "old" approval: an active student with no CredentialDelivery record.
    await User.create({
      email: 'old@x.test',
      passwordHash: await hashPassword('whatever'),
      role: 'student',
      name: 'Old Oak',
      status: 'active',
    });
    const list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', admin);
    expect(list.status).toBe(200);
    const old = list.body.items.find((i: { email: string }) => i.email === 'old@x.test');
    expect(old).toBeTruthy();
    expect(old.password).toBeNull();
  });

  it('regenerate issues a new password: old login fails, new works, /approved shows new', async () => {
    const admin = await seedAdmin();
    const pending = await seedPending('r@x.test', 'Regen Rae');
    const first = await request(app).post(`/api/admin/access-requests/${pending._id}/accept`).set('Cookie', admin);
    const oldPw = first.body.password as string;

    const regen = await request(app).post(`/api/admin/access-requests/${pending._id}/regenerate`).set('Cookie', admin);
    expect(regen.status).toBe(200);
    const newPw = regen.body.password as string;
    expect(newPw).not.toBe(oldPw);

    expect((await request(app).post('/api/auth/login').send({ email: 'r@x.test', password: oldPw })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'r@x.test', password: newPw })).status).toBe(200);

    const list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', admin);
    expect(list.body.items[0].password).toBe(newPw);
  });

  it('degrades when the key is absent: accept still works, password comes back null', async () => {
    const admin = await seedAdmin();
    const pending = await seedPending('n@x.test', 'Nokey Nia');
    delete process.env.CREDENTIAL_ENC_KEY;
    const acc = await request(app).post(`/api/admin/access-requests/${pending._id}/accept`).set('Cookie', admin);
    expect(acc.status).toBe(200);
    expect(acc.body.password).toHaveLength(14); // still returned once
    const list = await request(app).get('/api/admin/access-requests/approved').set('Cookie', admin);
    expect(list.body.items).toHaveLength(1); // student still approved…
    expect(list.body.items[0].password).toBeNull(); // …but nothing stored without a key
  });
});
