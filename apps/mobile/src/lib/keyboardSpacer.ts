// Height of the spacer that lifts content above the Android soft keyboard. The
// keyboard covers the bottom safe-area inset too, so that inset is subtracted.
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
// keyboard. All values are dp. `inputWindowY` comes from measureInWindow, which
// on Android is relative to the visible window frame, i.e. it lacks the status
// bar height (`topInset`; pass StatusBar.currentHeight, the exact amount, not a
// cutout-inflated safe-area inset). `keyboardHeight` is Reanimated's
// useAnimatedKeyboard height, which is the IME inset MINUS the system-bars
// bottom inset (Keyboard.java updateHeight, isNavigationBarTranslucent unset),
// so the real keyboard top is screenHeight - keyboardHeight - bottomInset. The
// window is edge-to-edge (full display), so `screen` height is its bottom, and
// `bottomInset` is the same systemBars bottom inset Reanimated subtracted, which
// makes this independent of the device's cutouts (they only affect top/sides). Zero when already visible, so inputs that
// are not covered never move.
export function revealScrollDelta(
  inputWindowY: number,
  inputHeight: number,
  reserve: number,
  screenHeight: number,
  keyboardHeight: number,
  bottomInset: number,
  topInset: number,
): number {
  const inputBottom = inputWindowY + topInset + inputHeight;
  return Math.max(inputBottom + reserve - (screenHeight - keyboardHeight - bottomInset), 0);
}
