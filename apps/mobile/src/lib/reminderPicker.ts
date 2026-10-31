// ReminderField's picker flow. @react-native-community/datetimepicker has no
// Android "datetime" mode (it silently falls back to the date dialog), so
// Android asks for the date, then the time; iOS shows one datetime wheel.

export type ReminderPickerStep = 'datetime' | 'date' | 'time';

/** The first picker step for a platform (`Platform.OS`). */
export function firstReminderPickerStep(os: string): ReminderPickerStep {
  return os === 'android' ? 'date' : 'datetime';
}

/** A calendar day as fields: unlike a Date it cannot shift when the device time zone changes. */
export interface PickedDay {
  year: number;
  month: number; // 0-11, like Date
  date: number;
}

/** The calendar day of a dialog result, read in the time zone the dialog used. */
export function pickedDay(d: Date): PickedDay {
  return { year: d.getFullYear(), month: d.getMonth(), date: d.getDate() };
}

/** The day `day` at the hour and minute of `time` (local time, seconds zeroed). */
export function combineDayAndTime(day: PickedDay, time: Date): Date {
  return new Date(day.year, day.month, day.date, time.getHours(), time.getMinutes(), 0, 0);
}

export interface ReminderDialogResult {
  /** The step to show next, or null when the flow is over. */
  next: ReminderPickerStep | null;
  /** The day carried from the date step, or null. */
  day: PickedDay | null;
  /** The value to commit, or null when nothing is committed. */
  commit: Date | null;
}

/**
 * One Android dialog event: date 'set' moves on to the time dialog, time 'set'
 * commits (day combined with the time), anything else cancels and discards.
 */
export function reminderDialogStep(step: ReminderPickerStep, day: PickedDay | null, eventType: string, d?: Date): ReminderDialogResult {
  if (eventType !== 'set' || !d) return { next: null, day: null, commit: null };
  // The day is carried as fields, so a time zone change while the time dialog
  // is open (of any size) cannot move it.
  if (step === 'date') return { next: 'time', day: pickedDay(d), commit: null };
  return { next: null, day: null, commit: day ? combineDayAndTime(day, d) : d };
}

/** Time of day for the reminder row, in the app locale (12h or 24h as that locale formats it). */
export function formatReminderTime(d: Date, locale: string): string {
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Whether the app locale shows a 24h clock. The same source as
 * formatReminderTime, so the Android dialog (is24Hour) matches the row text.
 * Detected from a formatted 13:00 sample instead of resolvedOptions().hourCycle,
 * which not every Hermes build reports.
 */
export function uses24h(locale: string): boolean {
  return /13/.test(new Date(2020, 0, 1, 13, 0).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }));
}
