import { describe, expect, it } from 'vitest';
import { keyboardSpacerHeight, revealScrollDelta } from '../src/lib/keyboardSpacer';

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

describe('revealScrollDelta', () => {
  // screen 2400px-equivalent 900dp, keyboard 300dp -> visible bottom at 600
  it('is zero when the input and its reserve are above the keyboard', () => {
    expect(revealScrollDelta(300, 40, 100, 900, 300)).toBe(0);
  });
  it('is zero without a keyboard', () => {
    expect(revealScrollDelta(700, 40, 100, 900, 0)).toBe(0);
  });
  it('scrolls by the part of input plus reserve below the keyboard top', () => {
    expect(revealScrollDelta(550, 40, 100, 900, 300)).toBe(90);
  });
  it('scrolls an input that sits fully under the keyboard', () => {
    expect(revealScrollDelta(800, 40, 100, 900, 300)).toBe(340);
  });
});
