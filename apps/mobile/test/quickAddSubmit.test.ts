import { describe, expect, it } from 'vitest';
import { applyChange, interpretChange, textToSubmit } from '../src/lib/quickAddInput';

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

// The submit button used to read the `text` state, which lags the native field
// by a render: a press within one frame of the last keystroke sent the text
// without its last character.

describe('quick-add latest text', () => {
  it('submits the newest typed text before any re-render', () => {
    const latest = { current: '' };
    applyChange(latest, 'ab');
    applyChange(latest, 'abc');
    expect(textToSubmit(undefined, latest)).toBe('abc');
  });

  it('prefers an explicit raw value', () => {
    const latest = { current: 'abc' };
    expect(textToSubmit('xyz', latest)).toBe('xyz');
  });

  it('records the cleared text after a hardware Return', () => {
    const latest = { current: '' };
    const intent = applyChange(latest, 'Buy milk\n');
    expect(intent.submit).toBe('Buy milk');
    expect(latest.current).toBe('');
  });
});
