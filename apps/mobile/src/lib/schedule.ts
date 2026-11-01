/**
 * Whether ScheduleSheet's date picker shows: only for the task it was opened
 * for, and never while the sheet is closed. Every close path nulls the
 * store's scheduleTaskId, so this hides the picker in the same render.
 */
export function schedulePickerOpen(pickerFor: string | null, taskId: string | null): boolean {
  return taskId != null && pickerFor === taskId;
}
