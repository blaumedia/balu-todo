import { describe, expect, it } from 'vitest';
import { combineDayAndTime, firstReminderPickerStep } from '../src/lib/reminderPicker';

describe('firstReminderPickerStep', () => {
  it('starts Android with the date dialog', () => {
    expect(firstReminderPickerStep('android')).toBe('date');
  });
  it('uses the single datetime wheel elsewhere', () => {
    expect(firstReminderPickerStep('ios')).toBe('datetime');
    expect(firstReminderPickerStep('web')).toBe('datetime');
  });
});

describe('combineDayAndTime', () => {
  it('takes the day of the first and the hour and minute of the second, seconds zeroed', () => {
    const r = combineDayAndTime(new Date(2026, 10, 3, 12), new Date(2020, 0, 1, 18, 45, 30));
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(10);
    expect(r.getDate()).toBe(3);
    expect(r.getHours()).toBe(18);
    expect(r.getMinutes()).toBe(45);
    expect(r.getSeconds()).toBe(0);
  });
});
