import { test, expect } from 'vitest';
import { formatStamp } from '../src/lib/format';

test('formatStamp produces MON DD · HH:MM in 24-hour time', () => {
  // 2026-08-21 20:30 local → AUG 21 · 20:30
  const ts = new Date(2026, 7, 21, 20, 30).getTime();
  expect(formatStamp(ts)).toBe('AUG 21 · 20:30');
});

test('pads single-digit days, hours, and minutes', () => {
  // 2026-01-03 01:05 local → JAN 03 · 01:05
  const ts = new Date(2026, 0, 3, 1, 5).getTime();
  expect(formatStamp(ts)).toBe('JAN 03 · 01:05');
});

test('rolls the month and wraps midnight at 00:00', () => {
  // 2026-12-31 00:00 local → DEC 31 · 00:00
  const ts = new Date(2026, 11, 31, 0, 0).getTime();
  expect(formatStamp(ts)).toBe('DEC 31 · 00:00');
});