import { describe, expect, it } from 'vitest';
import { timestampLabel } from '../src/lib/format';

describe('timestampLabel', () => {
  const now = new Date(2026, 7, 5, 12, 0, 0); // local noon
  const at = (d: number, h: number, mi: number) => new Date(2026, 7, d, h, mi).toISOString();

  it('formats German dates with the year and a 24h clock', () => {
    expect(timestampLabel(at(5, 14, 5), now.getTime(), 'de')).toBe('5. Aug. 2026, 14:05');
  });

  it('formats English dates locale-naturally but still 24h', () => {
    expect(timestampLabel(at(5, 14, 5), now.getTime(), 'en')).toBe('Aug 5, 2026, 14:05');
  });

  it('drops the clock on an earlier day', () => {
    expect(timestampLabel(at(1, 9, 0), now.getTime(), 'de')).toBe('1. Aug. 2026');
  });
});
