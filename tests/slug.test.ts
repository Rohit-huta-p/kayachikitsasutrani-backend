import { describe, it, expect } from 'vitest';
import { isValidSlug } from '../src/lib/slug.js';

describe('isValidSlug', () => {
  it('accepts simple lowercase words', () => {
    expect(isValidSlug('taruna-jwara')).toBe(true);
    expect(isValidSlug('shloka')).toBe(true);
    expect(isValidSlug('nava-jwara-chikitsa')).toBe(true);
  });

  it('accepts digits in slug', () => {
    expect(isValidSlug('shloka-142')).toBe(true);
    expect(isValidSlug('chapter-1-shloka-2')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidSlug('Taruna-Jwara')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidSlug('taruna jwara')).toBe(false);
  });

  it('rejects leading or trailing hyphen', () => {
    expect(isValidSlug('-taruna')).toBe(false);
    expect(isValidSlug('taruna-')).toBe(false);
  });

  it('rejects double hyphens', () => {
    expect(isValidSlug('taruna--jwara')).toBe(false);
  });

  it('rejects path-like characters', () => {
    expect(isValidSlug('taruna/jwara')).toBe(false);
    expect(isValidSlug('../etc')).toBe(false);
    expect(isValidSlug('taruna.jwara')).toBe(false);
  });

  it('rejects unicode word chars', () => {
    expect(isValidSlug('शloka')).toBe(false);
  });

  it('enforces length 1..80', () => {
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('a'.repeat(80))).toBe(true);
    expect(isValidSlug('a'.repeat(81))).toBe(false);
  });
});
