// Height of the spacer that lifts content above the Android soft keyboard. The
// keyboard covers the bottom safe-area inset too, so that inset is subtracted.
// Callers are expected to already reserve at least bottomInset of bottom padding
// below their content, so the clearance above the IME is never smaller than
// without the spacer. Never negative.
export function keyboardSpacerHeight(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  return Math.max(keyboardHeight - bottomInset, 0);
}

// How far (dp) a scroll view must scroll forward so that a focused input, plus
// `reserve` dp of content below it (submit / cancel buttons), ends up above the
// keyboard. All values are dp. `inputWindowY` comes from measureInWindow, which
// on Android is relative to the visible window frame, i.e. it lacks the status
// bar height (`topInset`). The keyboard top sits `bottomInset` (navigation bar)
// higher than screenHeight - keyboardHeight (review 76485a61 N3: both measured
// 24dp on device, 48dp together). Zero when already visible, so inputs that
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
