// Quick-add composer input handling. Pure — no React Native imports — so it can
// be unit-tested in plain node, like reminderPlan and serverUrl.

export interface ChangeIntent {
  /** Text to submit as a task, or null when this was ordinary typing. */
  submit: string | null;
  /** What the input's value should become. */
  text: string;
}

/**
 * Decide what an `onChangeText` value means.
 *
 * A hardware Return on a multiline `TextInput` reaches the app as a *text
 * change* containing `\n`, not as an editor action, so `onSubmitEditing` never
 * fires on iOS (`submitBehavior="submit"` only governs the on-screen keyboard's
 * return key). Flattening the newline to a space — the previous behaviour — made
 * Return silently do nothing: no task, no feedback, just an extra space. With a
 * Magic Keyboard attached that left no way to add a task at all.
 *
 * A newline therefore means "submit". Embedded newlines from a paste are
 * flattened into the same single task rather than splitting it.
 */
export function interpretChange(value: string): ChangeIntent {
  if (value.includes('\n')) {
    const flattened = value.replace(/\n/g, ' ').trim();
    return flattened ? { submit: flattened, text: '' } : { submit: null, text: '' };
  }
  return { submit: null, text: value };
}
