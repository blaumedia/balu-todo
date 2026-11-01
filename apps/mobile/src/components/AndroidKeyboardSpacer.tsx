import { Platform } from 'react-native';
import Animated, {
  KeyboardState,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { keyboardSpacerHeight } from '../lib/keyboardSpacer';

interface Props {
  bottomInset: number;
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
function Inner({ bottomInset, onKeyboardSettled }: Props) {
  const keyboard = useAnimatedKeyboard();
  const style = useAnimatedStyle(() => ({
    height: keyboardSpacerHeight(keyboard.height.value, bottomInset),
  }));
  // The settled height: the IME height while OPEN (it changes again when the
  // suggestion strip appears), 0 when CLOSED, -1 while animating (ignored).
  useAnimatedReaction(
    () =>
      keyboard.state.value === KeyboardState.OPEN
        ? keyboard.height.value
        : keyboard.state.value === KeyboardState.CLOSED
          ? 0
          : -1,
    (settled, previous) => {
      if (onKeyboardSettled && settled >= 0 && settled !== previous) runOnJS(onKeyboardSettled)(settled);
    },
  );
  return <Animated.View style={style} />;
}

// Renders nothing off Android: on iOS 26 useAnimatedKeyboard is broken
// (reanimated #8270) and the Keyboard-event path / automaticallyAdjustKeyboardInsets
// works fine, so the hook lives in the Android-only inner component.
export function AndroidKeyboardSpacer(props: Props) {
  if (Platform.OS !== 'android') return null;
  return <Inner {...props} />;
}
