import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('cloudinary', async () => await import('../__mocks__/cloudinary.js'));

import { uploadBuffer, deleteAsset } from '../src/lib/cloudinary.js';
import { __mocks } from '../__mocks__/cloudinary.js';

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.MONGO_URI = 'mongodb://localhost:27017/test';
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
  process.env.ADMIN_EMAIL = 'a@b.com';
  process.env.ADMIN_PASSWORD = 'password123';
  process.env.ADMIN_NAME = 'A';
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = '123';
  process.env.CLOUDINARY_API_SECRET = 'sssss';
  __mocks.uploadStreamMock.mockClear();
  __mocks.destroyMock.mockClear();
});

describe('cloudinary wrapper', () => {
  it('uploadBuffer returns url + publicId', async () => {
    const buf = Buffer.from('fake');
    const result = await uploadBuffer(buf, 'shlokas/audio', 'video');
    expect(result.url).toContain('res.cloudinary.com');
    expect(result.publicId).toContain('shlokas/audio/');
    expect(result.duration).toBe(12.3);
  });

  it('uploadBuffer image returns width/height', async () => {
    const result = await uploadBuffer(Buffer.from('x'), 'shlokas/images', 'image');
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('deleteAsset calls destroy with publicId + resource_type', async () => {
    await deleteAsset('shlokas/audio/foo', 'video');
    expect(__mocks.destroyMock).toHaveBeenCalledWith('shlokas/audio/foo', { resource_type: 'video' });
  });
});
