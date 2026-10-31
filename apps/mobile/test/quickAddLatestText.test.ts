import { describe, expect, it } from 'vitest';
import { applyChange, textToSubmit } from '../src/lib/quickAddInput';

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
