// Height of the spacer that lifts content above the Android soft keyboard. The
// keyboard covers the bottom safe-area inset too, so that inset is subtracted
// (it is already part of the content's own bottom padding). Never negative.
export function keyboardSpacerHeight(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  return Math.max(keyboardHeight - bottomInset, 0);
}
