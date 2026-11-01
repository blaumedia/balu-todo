import { describe, expect, it } from 'vitest';
import {
  keyboardSpacerHeight,
  pendingAfter,
  revealScrollDelta,
  revealScrollDeltaWithTarget,
  settleAction,
  settledKeyboardHeight,
  touchingAfter,
} from '../src/lib/keyboardSpacer';

describe('keyboardSpacerHeight', () => {
  it('is zero without a keyboard', () => {
    expect(keyboardSpacerHeight(0, 48)).toBe(0);
  });
  it('subtracts the bottom inset the (full-IME-inset) keyboard height already covers', () => {
    expect(keyboardSpacerHeight(900, 48)).toBe(852);
  });
  it('never goes negative when the inset exceeds the keyboard height', () => {
    expect(keyboardSpacerHeight(20, 48)).toBe(0);
  });
});

describe('revealScrollDelta', () => {
  // window bottom 900dp, keyboard 300dp -> keyboard top at 600
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
  it('takes the keyboard top as windowBottom minus the full IME height', () => {
    // measured: root at y -24 with height 914.29 -> windowBottom 890.29, IME 336
    // -> keyboard top 554.29, identical on gesture and 3-button navigation
    expect(revealScrollDelta(374.29, 40, 140, 890.29, 336)).toBeCloseTo(0, 5);
    expect(revealScrollDelta(384.29, 40, 140, 890.29, 336)).toBeCloseTo(10, 5);
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

describe('touch tracking', () => {
  it('has a finger down only between start and end or cancel', () => {
    expect(touchingAfter('start')).toBe(true);
    expect(touchingAfter('end')).toBe(false);
    expect(touchingAfter('cancel')).toBe(false);
  });
  it('reveals on a settle after a cancelled touch instead of deferring it', () => {
    expect(settleAction(310, touchingAfter('start'))).toBe('defer');
    expect(settleAction(310, touchingAfter('cancel'))).toBe('reveal');
  });
  it('resets when the keyboard is closed, touching or not', () => {
    expect(settleAction(0, true)).toBe('reset');
    expect(settleAction(0, false)).toBe('reset');
  });
});

describe('pendingAfter', () => {
  it('a settle during a touch, then a cancel (the user scrolled): no reveal is owed for a later tap', () => {
    let pending = settleAction(310, touchingAfter('start')) === 'defer';
    expect(pending).toBe(true);
    pending = pendingAfter('cancel', pending);
    expect(pending).toBe(false);
    // the next tap starts and ends without a pending reveal
    pending = pendingAfter('start', pending);
    expect(pending).toBe(false);
  });

  it('keeps a deferred reveal through a start and consumes it on the end', () => {
    expect(pendingAfter('start', true)).toBe(true);
    expect(pendingAfter('end', true)).toBe(false);
  });
});

describe('revealScrollDeltaWithTarget', () => {
  // window 2000 high, keyboard 600 high: keyboard top at 1400
  it('equals the input reveal without a target', () => {
    expect(revealScrollDeltaWithTarget(300, 40, 100, 2000, 600, undefined)).toBe(
      revealScrollDelta(300, 40, 100, 2000, 600),
    );
  });

  it('scrolls a covered submit button above the keyboard although the input is visible', () => {
    // input at 400 is visible with its reserve, the button bottom at 1500 is not
    expect(revealScrollDeltaWithTarget(400, 40, 100, 2000, 600, 1500)).toBe(100);
  });

  it('does not move when the target is already above the keyboard', () => {
    expect(revealScrollDeltaWithTarget(400, 40, 100, 2000, 600, 1300)).toBe(0);
  });

  it('keeps the focused input visible when both cannot fit', () => {
    // target needs 900 but the input (y 500) may only travel 500 before the top
    expect(revealScrollDeltaWithTarget(500, 40, 100, 2000, 600, 2300)).toBe(500);
  });

  it('never scrolls less than the plain input reveal', () => {
    // input covered needs 340; the target alone would need only 100
    expect(revealScrollDeltaWithTarget(1500, 40, 100, 2000, 600, 1500)).toBe(
      revealScrollDelta(1500, 40, 100, 2000, 600),
    );
  });
});
