import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { keyboardSpacerHeight } from '../lib/keyboardSpacer';

// On Android (edge-to-edge is mandatory since SDK 54) the window does NOT
// resize for the keyboard, whatever windowSoftInputMode says, and the Keyboard
// event's endCoordinates.height is garbage (negative). Reanimated's
// useAnimatedKeyboard reads the real IME inset via WindowInsetsAnimation, so an
// animated-height spacer as the last child of a sheet or a ScrollView's content
// lifts it (or makes it scrollable) above the IME. Android-only: render it
// behind a Platform.OS check - on iOS 26 that hook is broken (reanimated #8270)
// and the Keyboard-event path / automaticallyAdjustKeyboardInsets works fine.
export function AndroidKeyboardSpacer({ bottomInset }: { bottomInset: number }) {
  const keyboard = useAnimatedKeyboard();
  const style = useAnimatedStyle(() => ({
    height: keyboardSpacerHeight(keyboard.height.value, bottomInset),
  }));
  return <Animated.View style={style} />;
}
