import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, {
  KeyboardState,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { keyboardSpacerHeight, settledKeyboardHeight } from '../lib/keyboardSpacer';

interface Props {
  bottomInset: number;
  // Drive the height with a Reanimated animated style so it follows the IME
  // frame by frame (the bottom sheet rises with the keyboard). Default: plain
  // React-state height that jumps once the keyboard has settled. Scroll views
  // need the state height: an animated-style height change is not reliably
  // committed to layout on the first keyboard after a cold start, so the
  // ScrollView content never grew and there was nothing to scroll.
  animated?: boolean;
  // Called (JS thread) once the keyboard has settled: with the IME height when
  // fully open (again when it changes while open), with 0 when fully closed.
  onKeyboardSettled?: (keyboardHeight: number) => void;
}

// On Android (edge-to-edge is mandatory since SDK 54) the window does NOT
// resize for the keyboard, whatever windowSoftInputMode says, and the Keyboard
// event's endCoordinates.height is garbage (negative). Reanimated's
// useAnimatedKeyboard reads the real IME inset via WindowInsetsAnimation, so an
// animated-height spacer as the last child of a sheet or a ScrollView's content
// lifts it (or makes it scrollable) above the IME.
function AnimatedInner({ bottomInset, onKeyboardSettled }: Props) {
  const keyboard = useAnimatedKeyboard();
  const style = useAnimatedStyle(() => ({
    height: keyboardSpacerHeight(keyboard.height.value, bottomInset),
  }));
  // The settled height: the IME height while OPEN (it changes again when the
  // suggestion strip appears), 0 when CLOSED, -1 while animating (ignored).
  useAnimatedReaction(
    () => settledKeyboardHeight(keyboard.state.value, keyboard.height.value, KeyboardState.OPEN, KeyboardState.CLOSED),
    (settled, previous) => {
      if (onKeyboardSettled && settled >= 0 && settled !== previous) runOnJS(onKeyboardSettled)(settled);
    },
  );
  return <Animated.View style={style} />;
}

// Same settle detection, but the spacer height is React state, so it goes
// through the normal commit and layout path (and the ScrollView content size)
// like any other prop. The height is set before onKeyboardSettled fires.
function StateInner({ bottomInset, onKeyboardSettled }: Props) {
  const keyboard = useAnimatedKeyboard();
  const [height, setHeight] = useState(0);
  const onSettled = useCallback(
    (settled: number) => {
      setHeight(keyboardSpacerHeight(settled, bottomInset));
      onKeyboardSettled?.(settled);
    },
    [bottomInset, onKeyboardSettled],
  );
  useAnimatedReaction(
    () => settledKeyboardHeight(keyboard.state.value, keyboard.height.value, KeyboardState.OPEN, KeyboardState.CLOSED),
    (settled, previous) => {
      if (settled >= 0 && settled !== previous) runOnJS(onSettled)(settled);
    },
  );
  return <View style={{ height }} />;
}

// Renders nothing off Android: on iOS 26 useAnimatedKeyboard is broken
// (reanimated #8270) and the Keyboard-event path / automaticallyAdjustKeyboardInsets
// works fine, so the hook lives in the Android-only inner component.
export function AndroidKeyboardSpacer(props: Props) {
  if (Platform.OS !== 'android') return null;
  return props.animated ? <AnimatedInner {...props} /> : <StateInner {...props} />;
}
