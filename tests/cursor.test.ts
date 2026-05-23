import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../src/lib/cursor.js';

describe('cursor', () => {
  it('encodes and decodes a cursor', () => {
    const c = { createdAt: '2026-05-24T10:00:00.000Z', id: '507f1f77bcf86cd799439011' };
    const token = encodeCursor(c);
    expect(typeof token).toBe('string');
    expect(decodeCursor(token)).toEqual(c);
  });

  it('decodeCursor returns null for empty input', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('decodeCursor returns null for malformed input', () => {
    expect(decodeCursor('not-base64!!!')).toBeNull();
    expect(decodeCursor(Buffer.from('not json').toString('base64'))).toBeNull();
  });

  it('decodeCursor returns null when shape is wrong', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
    expect(decodeCursor(bad)).toBeNull();
  });
});
