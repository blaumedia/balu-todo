import { describe, expect, it } from 'vitest';
import { combineDayAndTime, firstReminderPickerStep, reminderDialogStep } from '../src/lib/reminderPicker';

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

describe('reminderDialogStep', () => {
  const day = new Date(2026, 10, 3, 12);
  const time = new Date(2020, 0, 1, 18, 45);
  it('moves from the date dialog to the time dialog, keeping the day', () => {
    expect(reminderDialogStep('date', null, 'set', day)).toEqual({ next: 'time', day, commit: null });
  });
  it('commits the day combined with the time on the time dialog OK', () => {
    const r = reminderDialogStep('time', day, 'set', time);
    expect(r.next).toBeNull();
    expect(r.day).toBeNull();
    expect(r.commit?.getTime()).toBe(new Date(2026, 10, 3, 18, 45).getTime());
  });
  it('falls back to the raw time when the time dialog OK arrives without a day', () => {
    expect(reminderDialogStep('time', null, 'set', time)).toEqual({ next: null, day: null, commit: time });
  });
  it('discards everything when the time dialog is cancelled', () => {
    expect(reminderDialogStep('time', day, 'dismissed', undefined)).toEqual({ next: null, day: null, commit: null });
  });
  it('closes without committing when the date dialog is dismissed', () => {
    expect(reminderDialogStep('date', null, 'dismissed', undefined)).toEqual({ next: null, day: null, commit: null });
  });
});
