import { describe, expect, it } from 'vitest';
import { schedulePickerOpen } from '../src/lib/schedule';

describe('schedulePickerOpen', () => {
  it('is open for the task it was opened for', () => {
    expect(schedulePickerOpen('t1', 't1')).toBe(true);
  });
  it('is closed while the sheet is closed', () => {
    expect(schedulePickerOpen('t1', null)).toBe(false);
  });
  it('is closed for a different task', () => {
    expect(schedulePickerOpen('t1', 't2')).toBe(false);
  });
  it('is closed when never opened', () => {
    expect(schedulePickerOpen(null, 't1')).toBe(false);
  });
});
