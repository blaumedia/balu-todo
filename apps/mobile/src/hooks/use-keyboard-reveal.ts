import { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { pendingAfter, revealScrollDelta, settleAction, touchingAfter } from '../lib/keyboardSpacer';
import { rootViewRef } from '../lib/rootViewRef';

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
// AndroidKeyboardSpacer does not trigger a scroll either. Attach `ref`,
// `onScroll` (or setOffset), `onTouchStart`, `onTouchEnd` and `onTouchCancel` to
// the scroll view and pass `onKeyboardSettled` to <AndroidKeyboardSpacer>: when
// the IME has opened, or a
// tap moves focus to another input while it is open, it scrolls the focused
// input (plus REVEAL_RESERVE) above the IME, only if it is covered and only if
// it is inside this scroll view.
export function useKeyboardReveal() {
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
      // Wait for the React commit and layout of the spacer height so the content
      // is tall enough to scroll (scrollTo clamps to the content size).
      timer.current = setTimeout(
        () => {
          timer.current = null;
          const input = TextInput.State.currentlyFocusedInput?.();
          const scrollable = ref.current as RevealScrollable | null;
          if (!input || !scrollable) return;
          if (onlyIfNewInput && input === lastRevealed.current) return;
          const node = contentNode(scrollable);
          if (!node) return;
          const root = rootViewRef.current;
          if (!root) return;
          input.measureLayout(
            node as never,
            () => {
              // Input and root are measured in the same (window) coordinate
              // system, so the keyboard top needs no inset corrections.
              root.measureInWindow((_rx, rootY, _rw, rootH) => {
                input.measureInWindow((_x, y, _w, h) => {
                  lastRevealed.current = input;
                  const delta = revealScrollDelta(y, h, REVEAL_RESERVE, rootY + rootH, kh);
                  if (delta <= 0) return;
                  const next = offset.current + delta;
                  if (scrollable.scrollTo)
                    scrollable.scrollTo({ y: next, animated: true });
                  else
                    scrollable.scrollToOffset?.({ offset: next, animated: true });
                });
              });
            },
            () => {}, // not a descendant of this scroll view: not ours to scroll
          );
        },
        120,
      );
    },
    [],
  );

  const onKeyboardSettled = useCallback(
    (kh: number) => {
      keyboardHeight.current = kh;
      const action = settleAction(kh, touching.current);
      if (action === 'reset') {
        lastRevealed.current = null;
        pending.current = false;
      } else if (action === 'defer') {
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
    touching.current = touchingAfter('start');
    touchStartOffset.current = offset.current;
  }, []);
  // The native scroll view / a drag gesture took the touch over: RN sends a
  // cancel, not an end. Release the touch and drop a deferred reveal: the user
  // scrolled, so neither now nor on a later tap.
  const onTouchCancel = useCallback(() => {
    touching.current = touchingAfter('cancel');
    pending.current = pendingAfter('cancel', pending.current);
  }, []);
  const onTouchEnd = useCallback(() => {
    touching.current = touchingAfter('end');
    if (keyboardHeight.current <= 0) return;
    const dragged = Math.abs(offset.current - touchStartOffset.current) >= 4;
    if (pending.current) {
      pending.current = pendingAfter('end', pending.current);
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
    onTouchCancel,
  };
}
