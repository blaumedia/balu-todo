// Reusable bottom sheet (DESIGN §7: radius 16, drag handle). Rendered as a
// plain absolute-fill overlay — the sheet components live at the root layout,
// as siblings after the navigator, so they already stack above every screen
// and the tab bar. Deliberately NOT an RN <Modal>: modals get their own
// window/host where keyboard reporting is unreliable (e.g. iOS 26).
//
// Two hard-won constraints shape this component:
// - Keyboard padding is plain React STATE, not a shared-value style: layout
//   props driven from useAnimatedStyle don't reliably relayout a view that
//   also runs a layout animation (the sheet stayed behind the keyboard until
//   some content change forced a reflow).
// - The slide-in is a manual spring on translateY, not an entering()
//   animation, for the same reason.
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Fill (nearly) the screen — used by the task detail sheet. */
  full?: boolean;
}

const SLIDE_FROM = 700;

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

// On Android (edge-to-edge is mandatory since SDK 54) the window does NOT
// resize for the keyboard and the Keyboard event's endCoordinates.height is
// garbage (negative) — the sheet would stay put with only its first row
// peeking out above the IME. Reanimated's useAnimatedKeyboard reads the real
// IME inset via WindowInsetsAnimation, so an animated-height spacer under the
// sheet content lifts it. Android-only: on iOS 26 that hook is broken
// (reanimated #8270) and the Keyboard-event path above works fine.
function AndroidKeyboardSpacer({ bottomInset }: { bottomInset: number }) {
  const keyboard = useAnimatedKeyboard();
  const style = useAnimatedStyle(() => ({
    height: Math.max(keyboard.height.value - bottomInset, 0),
  }));
  return <Animated.View style={style} />;
}

export function BottomSheet({ visible, onClose, children, full }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SLIDE_FROM);
  const keyboardHeight = useKeyboardHeight();

  useEffect(() => {
    if (visible) {
      translateY.value = SLIDE_FROM;
      translateY.value = withSpring(0, { damping: 24, stiffness: 240 });
    }
  }, [visible, translateY]);

  // Android hardware back closes the sheet (the Modal used to do this).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!visible) return null;

  // With the keyboard up, its height replaces the home-indicator inset (the
  // keyboard already covers that area). On Android the lift comes from the
  // AndroidKeyboardSpacer instead — the event height is unusable there.
  const bottomPad =
    Platform.OS !== 'android' && keyboardHeight > 0
      ? keyboardHeight + space.s3
      : insets.bottom + space.s4;

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <Animated.View entering={FadeIn.duration(150)} style={StyleSheet.absoluteFill}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: theme.border,
            paddingBottom: bottomPad,
            maxHeight: full ? '92%' : '88%',
            minHeight: full ? '70%' : undefined,
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={pan}>
          <View style={styles.handleArea}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
          </View>
        </GestureDetector>
        {children}
        {Platform.OS === 'android' ? <AndroidKeyboardSpacer bottomInset={insets.bottom} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'flex-end', zIndex: 100, elevation: 24 },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s5,
  },
  handleArea: { alignItems: 'center', paddingVertical: space.s3 },
  handle: { width: 36, height: 4, borderRadius: 2 },
});
