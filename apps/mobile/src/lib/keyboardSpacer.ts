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
// keyboard. All values are window coordinates / dp. Zero when already visible,
// so inputs that are not covered never move.
export function revealScrollDelta(
  inputWindowY: number,
  inputHeight: number,
  reserve: number,
  screenHeight: number,
  keyboardHeight: number,
): number {
  return Math.max(inputWindowY + inputHeight + reserve - (screenHeight - keyboardHeight), 0);
}
