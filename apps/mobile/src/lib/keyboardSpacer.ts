// Height of the spacer that lifts content above the Android soft keyboard. The
// keyboard height is the full IME inset and so already covers the bottom
// safe-area inset, which is subtracted.
// Callers are expected to already reserve at least bottomInset of bottom padding
// below their content, so the clearance above the IME is never smaller than
// without the spacer. Never negative.
export function keyboardSpacerHeight(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  return Math.max(keyboardHeight - bottomInset, 0);
}

// The settled keyboard height from Reanimated's useAnimatedKeyboard values:
// the IME height while fully open (it changes again when the suggestion strip
// appears), 0 when fully closed, -1 while animating (callers ignore it).
// `openState` / `closedState` are KeyboardState.OPEN / KeyboardState.CLOSED.
export function settledKeyboardHeight(
  state: number,
  height: number,
  openState: number,
  closedState: number,
): number {
  'worklet';
  return state === openState ? height : state === closedState ? 0 : -1;
}

// How far (dp) a scroll view must scroll forward so that a focused input, plus
// `reserve` dp of content below it (submit / cancel buttons), ends up above the
// keyboard. All values are dp. `inputWindowY` comes from measureInWindow and
// `windowBottom` must be the bottom edge of a full-screen root view measured
// with measureInWindow too (rootY + rootHeight), so both live in one coordinate
// system (measureInWindow's origin is the status bar's bottom edge on Android,
// so the root's own y is negative there). `keyboardHeight` is Reanimated's
// useAnimatedKeyboard height: with edge-to-edge on it is the full IME inset,
// reaching down to the display bottom, nav bar included (measured on gesture
// and 3-button navigation). The keyboard top is therefore
// windowBottom - keyboardHeight. Zero when already visible, so inputs that are
// not covered never move.
export function revealScrollDelta(
  inputWindowY: number,
  inputHeight: number,
  reserve: number,
  windowBottom: number,
  keyboardHeight: number,
): number {
  return Math.max(inputWindowY + inputHeight + reserve - (windowBottom - keyboardHeight), 0);
}

export type TouchEvent = 'start' | 'end' | 'cancel';

// Whether a finger is down after `event`. A cancel (RN sends it instead of an
// end when the native scroll view or a drag gesture takes the touch over) must
// release the touch too, or a stuck `true` defers every later keyboard settle
// to a tap that then reveals an input the user had scrolled away from.
export function touchingAfter(event: TouchEvent): boolean {
  return event === 'start';
}

// Whether a reveal deferred by a settle during a touch is still owed after
// `event`. A cancel means the user scrolled: drop it, or the next tap anywhere
// would snap back to the input they scrolled away from. An end consumes it (the
// caller reveals unless that touch was a drag); a start keeps it.
export function pendingAfter(event: TouchEvent, pending: boolean): boolean {
  return event === 'start' ? pending : false;
}

// What to do when the keyboard settles at `keyboardHeight`: forget the revealed
// input (closed), wait for the finger to lift (touching), or reveal now.
export function settleAction(keyboardHeight: number, touching: boolean): 'reset' | 'defer' | 'reveal' {
  if (keyboardHeight === 0) return 'reset';
  return touching ? 'defer' : 'reveal';
}
