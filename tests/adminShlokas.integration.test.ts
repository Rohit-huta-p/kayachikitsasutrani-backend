import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { __mocks as cloudinaryMocks } from '../__mocks__/cloudinary.js';

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
  adminCookie = `sht_session=${signSession(admin._id.toString(), 'a'.repeat(32))}`;
  studentCookie = `sht_session=${signSession(student._id.toString(), 'a'.repeat(32))}`;
});

const VALID_BODY = {
  slug: 'taruna-jwara',
  title: 'Taruna Jwara',
  meaning: 'Treatment for the early stage of fever',
  translation: 'In the early stage of jwara, ...',
  audio: {
    full: { url: 'https://res.cloudinary.com/x/full.mp3', publicId: 'shlokas/audio/full' },
    lines: [
      { url: 'https://res.cloudinary.com/x/line-1.mp3', publicId: 'shlokas/audio/l1' },
    ],
  },
  lines: [
    {
      sanskrit: 'लङ्घनं स्वेदनं',
      words: [
        { text: 'लङ्घनं', start: 0, end: 0.9 },
        { text: 'स्वेदनं', start: 0.9, end: 1.8 },
      ],
      fullTimings: [
        { text: 'लङ्घनं', start: 0, end: 0.9 },
        { text: 'स्वेदनं', start: 0.9, end: 1.8 },
      ],
    },
  ],
};

describe('POST /api/admin/shlokas', () => {
  it('admin creates a shloka → 200, status defaults to draft', async () => {
    const res = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('taruna-jwara');
    expect(res.body.status).toBe('draft');
    expect(res.body.audio.full.publicId).toBe('shlokas/audio/full');
    expect(res.body.id).toBeDefined();
  });

  it('student → 403', async () => {
    const res = await request(app).post('/api/admin/shlokas').set('Cookie', studentCookie).send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('duplicate slug → 409 SLUG_TAKEN', async () => {
    await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    const res = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  });

  it('invalid slug → 400', async () => {
    const res = await request(app)
      .post('/api/admin/shlokas')
      .set('Cookie', adminCookie)
      .send({ ...VALID_BODY, slug: 'Bad Slug!' });
    expect(res.status).toBe(400);
  });

  it('audio.lines.length mismatch with lines.length → 400 INVALID_TIMINGS', async () => {
    const body = {
      ...VALID_BODY,
      audio: { ...VALID_BODY.audio, lines: [] },
    };
    const res = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMINGS');
  });

  it('words and fullTimings count mismatch → 400 INVALID_TIMINGS', async () => {
    const body = {
      ...VALID_BODY,
      lines: [{ ...VALID_BODY.lines[0], fullTimings: [{ text: 'x', start: 0, end: 1 }] }],
    };
    const res = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMINGS');
  });

  it('overlapping word timings → 400 INVALID_TIMINGS', async () => {
    const body = {
      ...VALID_BODY,
      lines: [
        {
          ...VALID_BODY.lines[0],
          words: [
            { text: 'a', start: 0, end: 1 },
            { text: 'b', start: 0.5, end: 1.5 },
          ],
          fullTimings: [
            { text: 'a', start: 0, end: 1 },
            { text: 'b', start: 0.5, end: 1.5 },
          ],
        },
      ],
    };
    const res = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMINGS');
  });
});

describe('GET /api/admin/shlokas', () => {
  it('returns all (drafts + published) when status=all', async () => {
    await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    await request(app)
      .post('/api/admin/shlokas')
      .set('Cookie', adminCookie)
      .send({ ...VALID_BODY, slug: 'second', status: 'published' });

    const res = await request(app).get('/api/admin/shlokas?status=all').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('status=draft filters to drafts only', async () => {
    await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    await request(app)
      .post('/api/admin/shlokas')
      .set('Cookie', adminCookie)
      .send({ ...VALID_BODY, slug: 'pub', status: 'published' });

    const res = await request(app).get('/api/admin/shlokas?status=draft').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].slug).toBe('taruna-jwara');
  });

  it('student → 403', async () => {
    const res = await request(app).get('/api/admin/shlokas').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/shlokas/:id', () => {
  it('returns the shloka', async () => {
    const created = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    const res = await request(app).get(`/api/admin/shlokas/${created.body.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('taruna-jwara');
  });

  it('unknown id → 404', async () => {
    const res = await request(app).get('/api/admin/shlokas/507f1f77bcf86cd799439011').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/shlokas/:id', () => {
  it('updates title + status', async () => {
    const created = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    const res = await request(app)
      .patch(`/api/admin/shlokas/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'New Title', status: 'published' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New Title');
    expect(res.body.status).toBe('published');
  });

  it('can change slug if not colliding', async () => {
    const created = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    const res = await request(app)
      .patch(`/api/admin/shlokas/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ slug: 'renamed' });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('renamed');
  });

  it('slug colliding with another shloka → 409', async () => {
    const first = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    await request(app)
      .post('/api/admin/shlokas')
      .set('Cookie', adminCookie)
      .send({ ...VALID_BODY, slug: 'second' });
    const res = await request(app)
      .patch(`/api/admin/shlokas/${first.body.id}`)
      .set('Cookie', adminCookie)
      .send({ slug: 'second' });
    expect(res.status).toBe(409);
  });

  it('unknown id → 404', async () => {
    const res = await request(app)
      .patch('/api/admin/shlokas/507f1f77bcf86cd799439011')
      .set('Cookie', adminCookie)
      .send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('invalid timings in updated line → 400', async () => {
    const created = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    const res = await request(app)
      .patch(`/api/admin/shlokas/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({
        lines: [
          {
            sanskrit: 'x',
            words: [
              { text: 'a', start: 1, end: 0 },
            ],
            fullTimings: [{ text: 'a', start: 1, end: 0 }],
          },
        ],
        audio: { ...VALID_BODY.audio, lines: [VALID_BODY.audio.lines[0]] },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMINGS');
  });
});

describe('DELETE /api/admin/shlokas/:id', () => {
  it('deletes the shloka and calls Cloudinary destroy for each asset', async () => {
    cloudinaryMocks.destroyMock.mockClear();
    const body = {
      ...VALID_BODY,
      audio: {
        full: { url: 'https://res.cloudinary.com/x/full.mp3', publicId: 'pf' },
        lines: [
          { url: 'https://res.cloudinary.com/x/l1.mp3', publicId: 'p1' },
          { url: 'https://res.cloudinary.com/x/l2.mp3', publicId: 'p2' },
        ],
      },
      image: { url: 'https://res.cloudinary.com/x/img.png', publicId: 'pi' },
      lines: [
        VALID_BODY.lines[0],
        {
          sanskrit: 'x',
          words: [{ text: 'x', start: 0, end: 1 }],
          fullTimings: [{ text: 'x', start: 0, end: 1 }],
        },
      ],
    };
    const created = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(body);
    expect(created.status).toBe(200);
    const res = await request(app).delete(`/api/admin/shlokas/${created.body.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // destroy called for: full audio, 2 line audios, 1 image = 4 calls
    expect(cloudinaryMocks.destroyMock.mock.calls.length).toBe(4);
    const publicIds = cloudinaryMocks.destroyMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(publicIds).toContain('pf');
    expect(publicIds).toContain('p1');
    expect(publicIds).toContain('p2');
    expect(publicIds).toContain('pi');

    const after = await Shloka.findById(created.body.id);
    expect(after).toBeNull();
  });

  it('Cloudinary destroy failure still returns 200', async () => {
    cloudinaryMocks.destroyMock.mockClear();
    cloudinaryMocks.destroyMock.mockRejectedValueOnce(new Error('cloud failure'));
    const created = await request(app).post('/api/admin/shlokas').set('Cookie', adminCookie).send(VALID_BODY);
    const res = await request(app).delete(`/api/admin/shlokas/${created.body.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const after = await Shloka.findById(created.body.id);
    expect(after).toBeNull();
  });

  it('unknown id → 404', async () => {
    const res = await request(app).delete('/api/admin/shlokas/507f1f77bcf86cd799439011').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
