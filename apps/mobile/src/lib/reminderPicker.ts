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
