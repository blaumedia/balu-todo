// ReminderField's picker flow. @react-native-community/datetimepicker has no
// Android "datetime" mode (it silently falls back to the date dialog), so
// Android asks for the date, then the time; iOS shows one datetime wheel.

export type ReminderPickerStep = 'datetime' | 'date' | 'time';

/** The first picker step for a platform (`Platform.OS`). */
export function firstReminderPickerStep(os: string): ReminderPickerStep {
  return os === 'android' ? 'date' : 'datetime';
}

/** The calendar day of `day` at the hour and minute of `time` (local time, seconds zeroed). */
export function combineDayAndTime(day: Date, time: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes(), 0, 0);
}

export interface ReminderDialogResult {
  /** The step to show next, or null when the flow is over. */
  next: ReminderPickerStep | null;
  /** The day carried from the date step, or null. */
  day: Date | null;
  /** The value to commit, or null when nothing is committed. */
  commit: Date | null;
}

/**
 * One Android dialog event: date 'set' moves on to the time dialog, time 'set'
 * commits (day combined with the time), anything else cancels and discards.
 */
export function reminderDialogStep(step: ReminderPickerStep, day: Date | null, eventType: string, d?: Date): ReminderDialogResult {
  if (eventType !== 'set' || !d) return { next: null, day: null, commit: null };
  if (step === 'date') return { next: 'time', day: d, commit: null };
  return { next: null, day: null, commit: day ? combineDayAndTime(day, d) : d };
}
