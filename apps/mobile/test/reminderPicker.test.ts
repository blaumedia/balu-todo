import { afterEach, describe, expect, it } from 'vitest';
import { combineDayAndTime, firstReminderPickerStep, formatReminderTime, pickedDay, reminderDialogStep, uses24h } from '../src/lib/reminderPicker';

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
    const r = combineDayAndTime(pickedDay(new Date(2026, 10, 3, 12)), new Date(2020, 0, 1, 18, 45, 30));
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(10);
    expect(r.getDate()).toBe(3);
    expect(r.getHours()).toBe(18);
    expect(r.getMinutes()).toBe(45);
    expect(r.getSeconds()).toBe(0);
  });
});

describe('reminderDialogStep', () => {
  const day = pickedDay(new Date(2026, 10, 3, 12));
  const time = new Date(2020, 0, 1, 18, 45);
  it('moves from the date dialog to the time dialog, keeping the day', () => {
    expect(reminderDialogStep('date', null, 'set', new Date(2026, 10, 3, 12))).toEqual({ next: 'time', day, commit: null });
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

describe('time zone change between the dialogs', () => {
  const origTZ = process.env.TZ;
  afterEach(() => {
    if (origTZ === undefined) delete process.env.TZ;
    else process.env.TZ = origTZ;
  });
  const pickThenSwitch = (from: string, to: string) => {
    process.env.TZ = from;
    const picked = new Date(2026, 10, 3, 0, 5); // Nov 3 in `from`
    const r = reminderDialogStep('date', null, 'set', picked);
    process.env.TZ = to;
    return combineDayAndTime(r.day as NonNullable<typeof r.day>, new Date(2020, 0, 1, 9, 0));
  };
  it('keeps the picked day across a small shift', () => {
    const c = pickThenSwitch('America/Los_Angeles', 'America/New_York');
    expect([c.getMonth(), c.getDate(), c.getHours()]).toEqual([10, 3, 9]);
  });
  it('keeps the picked day across a shift of more than 12 hours', () => {
    const c = pickThenSwitch('America/Los_Angeles', 'Asia/Tokyo');
    expect([c.getMonth(), c.getDate(), c.getHours()]).toEqual([10, 3, 9]);
  });
});

describe('uses24h', () => {
  it('is true for de and false for en', () => {
    expect(uses24h('de')).toBe(true);
    expect(uses24h('en')).toBe(false);
  });
});

describe('formatReminderTime', () => {
  const d = new Date(2026, 10, 3, 14, 30);
  it('formats 24h for de', () => {
    expect(formatReminderTime(d, 'de')).toBe('14:30');
  });
  it('formats 12h for en-US', () => {
    expect(formatReminderTime(d, 'en')).toMatch(/^2:30\s?PM$/);
  });
});
