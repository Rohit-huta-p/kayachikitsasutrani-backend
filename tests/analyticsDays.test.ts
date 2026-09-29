import { describe, it, expect } from 'vitest';
import { addDays, dayInZone, daysBetween, isValidTimeZone, streaks, weekdayIndex } from '../src/lib/analyticsDays.js';

describe('analyticsDays', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-09-28', 0)).toBe('2026-09-28');
  });

  it('daysBetween is inclusive', () => {
    expect(daysBetween('2026-09-28', '2026-10-01')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
    expect(daysBetween('2026-09-28', '2026-09-28')).toEqual(['2026-09-28']);
  });

  it('weekdayIndex is Monday-first', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-04')).toBe(6); // Sunday
  });

  it('dayInZone uses the zone calendar, not UTC', () => {
    const instant = new Date('2026-09-28T20:00:00Z'); // 01:30 on the 29th in India
    expect(dayInZone(instant, 'Asia/Kolkata')).toBe('2026-09-29');
    expect(dayInZone(instant, 'UTC')).toBe('2026-09-28');
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('streaks: current run survives an idle today, longest spans the history', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-26', '2026-09-27'];
    expect(streaks(days, '2026-09-28')).toEqual({ current: 2, longest: 4 });
    expect(streaks([...days, '2026-09-28'], '2026-09-28')).toEqual({ current: 3, longest: 4 });
    expect(streaks(['2026-09-25'], '2026-09-28')).toEqual({ current: 0, longest: 1 });
    expect(streaks([], '2026-09-28')).toEqual({ current: 0, longest: 0 });
  });
});
