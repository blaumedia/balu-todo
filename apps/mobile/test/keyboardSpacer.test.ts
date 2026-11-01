import { describe, expect, it } from 'vitest';
import { keyboardSpacerHeight } from '../src/lib/keyboardSpacer';

describe('keyboardSpacerHeight', () => {
  it('is zero without a keyboard', () => {
    expect(keyboardSpacerHeight(0, 48)).toBe(0);
  });
  it('subtracts the bottom inset the keyboard already covers', () => {
    expect(keyboardSpacerHeight(900, 48)).toBe(852);
  });
  it('never goes negative when the inset exceeds the keyboard height', () => {
    expect(keyboardSpacerHeight(20, 48)).toBe(0);
  });
});
