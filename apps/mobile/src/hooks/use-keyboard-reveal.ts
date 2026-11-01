import { useCallback, useRef } from 'react';
import { Dimensions, TextInput, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { revealScrollDelta } from '../lib/keyboardSpacer';

// dp of content below a focused input (submit / Cancel / Delete buttons) that
// should end up above the keyboard together with the input.
const REVEAL_RESERVE = 140;

interface RevealScrollable {
  scrollTo?(opts: { y?: number; animated?: boolean }): void;
  scrollToOffset?(opts: { offset: number; animated?: boolean }): void;
}

// Android only (edge-to-edge): the ScrollView extends under the IME, so it
// considers a focused input "visible" and never scrolls to it, and growing the
// AndroidKeyboardSpacer does not trigger a scroll either. Attach `ref` and
// `onScroll` (or setOffset) and `onTouchStart` / `onTouchEnd` to the scroll view and pass
// `onKeyboardSettled` to <AndroidKeyboardSpacer>: when the IME has opened, or a
// tap moves focus to another input while it is open, it scrolls the focused
// input (plus REVEAL_RESERVE) above the IME, only if it is covered.
export function useKeyboardReveal() {
  const target = useRef<RevealScrollable | null>(null);
  // Callback ref: assignable to the ScrollView / FlatList ref props alike.
  const ref = useCallback((node: RevealScrollable | null) => {
    target.current = node;
  }, []);
  const offset = useRef(0);
  const keyboardHeight = useRef(0);
  const touchStartOffset = useRef(0);

  const setOffset = useCallback((y: number) => {
    offset.current = y;
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const reveal = useCallback((kh: number) => {
    // The spacer's height change is applied natively; give layout a moment so
    // the content is tall enough to scroll (scrollTo clamps to the content size).
    setTimeout(() => {
      const input = TextInput.State.currentlyFocusedInput?.();
      const scrollable = target.current;
      if (!input || !scrollable) return;
      input.measureInWindow((_x, y, _w, h) => {
        const delta = revealScrollDelta(y, h, REVEAL_RESERVE, Dimensions.get('screen').height, kh);
        if (delta <= 0) return;
        const next = offset.current + delta;
        if (scrollable.scrollTo) scrollable.scrollTo({ y: next, animated: true });
        else scrollable.scrollToOffset?.({ offset: next, animated: true });
      });
    }, 120);
  }, []);

  const onKeyboardSettled = useCallback(
    (kh: number) => {
      keyboardHeight.current = kh;
      if (kh > 0) reveal(kh);
    },
    [reveal],
  );
  // Touches bubble up from the inputs: a tap on another input while the IME is
  // already open changes focus without any keyboard event.
  // A drag that scrolled the content is not a tap: never fight the user's scroll.
  const onTouchStart = useCallback(() => {
    touchStartOffset.current = offset.current;
  }, []);
  const onTouchEnd = useCallback(() => {
    if (keyboardHeight.current > 0 && Math.abs(offset.current - touchStartOffset.current) < 4) {
      reveal(keyboardHeight.current);
    }
  }, [reveal]);

  return { ref, onScroll, setOffset, onKeyboardSettled, onTouchStart, onTouchEnd };
}
