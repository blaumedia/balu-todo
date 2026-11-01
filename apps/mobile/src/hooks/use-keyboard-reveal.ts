import { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  Platform,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { revealScrollDelta } from '../lib/keyboardSpacer';

// dp of content below a focused input (submit / Cancel / Delete buttons) that
// should end up above the keyboard together with the input.
const REVEAL_RESERVE = 140;

interface RevealScrollable {
  scrollTo?(opts: { y?: number; animated?: boolean }): void;
  scrollToOffset?(opts: { offset: number; animated?: boolean }): void;
  // ScrollView
  getInnerViewRef?(): unknown;
  getInnerViewNode?(): unknown;
  // FlatList: hands out its ScrollView
  getScrollResponder?(): RevealScrollable | null;
}

// The scroll view's content container: measureLayout against it only succeeds
// for inputs that are descendants of this scroll view.
function contentNode(scrollable: RevealScrollable): unknown {
  const own = scrollable.getInnerViewRef?.() ?? scrollable.getInnerViewNode?.();
  if (own) return own;
  const sv = scrollable.getScrollResponder?.();
  return sv?.getInnerViewRef?.() ?? sv?.getInnerViewNode?.();
}

// Android only (edge-to-edge): the ScrollView extends under the IME, so it
// considers a focused input "visible" and never scrolls to it, and growing the
// AndroidKeyboardSpacer does not trigger a scroll either. Attach `ref`, `onScroll`
// (or setOffset), `onTouchStart` and `onTouchEnd` to the scroll view and pass
// `onKeyboardSettled` to <AndroidKeyboardSpacer>: when the IME has opened, or a
// tap moves focus to another input while it is open, it scrolls the focused
// input (plus REVEAL_RESERVE) above the IME, only if it is covered and only if
// it is inside this scroll view.
export function useKeyboardReveal(insets: { top: number; bottom: number }) {
  const { top: topInset, bottom: bottomInset } = insets;
  // An object ref (not a callback ref): draggable-flatlist only auto-scrolls
  // while dragging if `"current" in ref` (review 76485a61 N1).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const offset = useRef(0);
  const keyboardHeight = useRef(0);
  const touchStartOffset = useRef(0);
  const touching = useRef(false);
  const pending = useRef(false);
  const lastRevealed = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const android = Platform.OS === 'android';

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setOffset = useCallback((y: number) => {
    offset.current = y;
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  // onlyIfNewInput: a tap must not re-reveal the input that was already revealed
  // (the user may have scrolled it away on purpose), only a newly focused one.
  const reveal = useCallback(
    (kh: number, onlyIfNewInput: boolean) => {
      // One reveal at a time: a newer one supersedes a pending one.
      if (timer.current) clearTimeout(timer.current);
      // The spacer's height change is applied natively; give layout a moment so
      // the content is tall enough to scroll (scrollTo clamps to the content size).
      timer.current = setTimeout(
        () => {
          timer.current = null;
          const input = TextInput.State.currentlyFocusedInput?.();
          const scrollable = ref.current as RevealScrollable | null;
          if (!input || !scrollable) return;
          if (onlyIfNewInput && input === lastRevealed.current) return;
          const node = contentNode(scrollable);
          if (!node) return;
          input.measureLayout(
            node as never,
            () => {
              input.measureInWindow((_x, y, _w, h) => {
                lastRevealed.current = input;
                const delta = revealScrollDelta(
                  y,
                  h,
                  REVEAL_RESERVE,
                  Dimensions.get('screen').height,
                  kh,
                  bottomInset,
                  topInset,
                );
                if (delta <= 0) return;
                const next = offset.current + delta;
                if (scrollable.scrollTo)
                  scrollable.scrollTo({ y: next, animated: true });
                else
                  scrollable.scrollToOffset?.({ offset: next, animated: true });
              });
            },
            () => {}, // not a descendant of this scroll view: not ours to scroll
          );
        },
        120,
      );
    },
    [bottomInset, topInset],
  );

  const onKeyboardSettled = useCallback(
    (kh: number) => {
      keyboardHeight.current = kh;
      if (kh === 0) {
        lastRevealed.current = null;
        pending.current = false;
      } else if (touching.current) {
        pending.current = true; // do not scroll under the user's finger; finish on touch end
      } else {
        reveal(kh, false);
      }
    },
    [reveal],
  );
  // Touches bubble up from the inputs: a tap on another input while the IME is
  // already open changes focus without any keyboard event.
  // A drag that scrolled the content is not a tap: never fight the user's scroll.
  const onTouchStart = useCallback(() => {
    touching.current = true;
    touchStartOffset.current = offset.current;
  }, []);
  const onTouchEnd = useCallback(() => {
    touching.current = false;
    if (keyboardHeight.current <= 0) return;
    const dragged = Math.abs(offset.current - touchStartOffset.current) >= 4;
    if (pending.current) {
      pending.current = false;
      if (!dragged) reveal(keyboardHeight.current, false);
    } else if (!dragged) {
      reveal(keyboardHeight.current, true);
    }
  }, [reveal]);

  return {
    ref,
    // JS scroll events only where the hook uses them.
    onScroll: android ? onScroll : undefined,
    scrollEventThrottle: android ? 16 : undefined,
    setOffset,
    onKeyboardSettled,
    onTouchStart,
    onTouchEnd,
  };
}
