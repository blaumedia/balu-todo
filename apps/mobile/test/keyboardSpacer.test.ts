import { describe, expect, it } from 'vitest';
import { keyboardSpacerHeight, revealScrollDelta, settledKeyboardHeight } from '../src/lib/keyboardSpacer';

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
    expect(revealScrollDelta(300, 40, 100, 900, 300, 0, 0)).toBe(0);
  });
  it('is zero without a keyboard', () => {
    expect(revealScrollDelta(700, 40, 100, 900, 0, 0, 0)).toBe(0);
  });
  it('scrolls by the part of input plus reserve below the keyboard top', () => {
    expect(revealScrollDelta(550, 40, 100, 900, 300, 0, 0)).toBe(90);
  });
  it('scrolls an input that sits fully under the keyboard', () => {
    expect(revealScrollDelta(800, 40, 100, 900, 300, 0, 0)).toBe(340);
  });
  it('treats the keyboard top as bottomInset higher than screen minus keyboard', () => {
    // without the inset this input is exactly visible (delta 0); with a 48 inset it is 48 under
    expect(revealScrollDelta(460, 40, 100, 900, 300, 0, 0)).toBe(0);
    expect(revealScrollDelta(460, 40, 100, 900, 300, 48, 0)).toBe(48);
  });
  it('adds the status bar height that measureInWindow leaves out of the input position', () => {
    expect(revealScrollDelta(460, 40, 100, 900, 300, 0, 0)).toBe(0);
    expect(revealScrollDelta(460, 40, 100, 900, 300, 0, 24)).toBe(24);
    expect(revealScrollDelta(460, 40, 100, 900, 300, 24, 24)).toBe(48);
  });
});

describe('settledKeyboardHeight', () => {
  const OPEN = 2;
  const CLOSED = 4;
  it('reports the IME height while fully open', () => {
    expect(settledKeyboardHeight(OPEN, 310, OPEN, CLOSED)).toBe(310);
  });
  it('reports 0 when fully closed, whatever the last height was', () => {
    expect(settledKeyboardHeight(CLOSED, 310, OPEN, CLOSED)).toBe(0);
  });
  it('reports -1 while opening or closing', () => {
    expect(settledKeyboardHeight(1, 120, OPEN, CLOSED)).toBe(-1);
    expect(settledKeyboardHeight(3, 120, OPEN, CLOSED)).toBe(-1);
  });
});
