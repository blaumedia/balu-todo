import { describe, expect, it } from 'vitest';
import { interpretChange } from '../src/lib/quickAddInput';

// A hardware Return on a multiline TextInput reaches the app as a *text change*
// containing "\n", not as an editor action — `onSubmitEditing` never fires on
// iOS. The old handler flattened it to a space, so pressing Return with a
// Bluetooth or Magic Keyboard silently did nothing: no task, no error, just an
// extra space. That made task creation impossible on an iPad with a keyboard.

describe('quick-add hardware Return', () => {
  it('submits when a newline arrives instead of swallowing it', () => {
    expect(interpretChange('Buy milk\n')).toEqual({ submit: 'Buy milk', text: '' });
  });

  it('flattens an embedded newline rather than splitting the task', () => {
    // Pasted multi-line text stays one task; the newline still triggers submit.
    expect(interpretChange('Buy milk\ntomorrow')).toEqual({
      submit: 'Buy milk tomorrow',
      text: '',
    });
  });

  it('ignores a bare Return on an empty composer', () => {
    expect(interpretChange('\n')).toEqual({ submit: null, text: '' });
    expect(interpretChange('   \n  ')).toEqual({ submit: null, text: '' });
  });

  it('leaves ordinary typing alone', () => {
    expect(interpretChange('Buy mil')).toEqual({ submit: null, text: 'Buy mil' });
    expect(interpretChange('')).toEqual({ submit: null, text: '' });
  });
});
