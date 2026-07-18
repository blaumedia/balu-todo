// Reusable bottom sheet (DESIGN §7: radius 16, drag handle). Rendered as a
// plain absolute-fill overlay — the sheet components live at the root layout,
// as siblings after the navigator, so they already stack above every screen
// and the tab bar. Deliberately NOT an RN <Modal>: modals get their own
// window/host where keyboard reporting (JS Keyboard events and
// KeyboardAvoidingView alike) is unreliable, e.g. on iOS 26 and on Android
// with statusBarTranslucent. In the normal hierarchy the keyboard height is
// dependable; we take the max of Reanimated's native tracker and the JS
// events and pad the sheet with it.
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
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

export function BottomSheet({ visible, onClose, children, full }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const keyboardJS = useSharedValue(0);

  useEffect(() => {
    if (visible) translateY.value = 0;
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

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      keyboardJS.value = e.endCoordinates.height;
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardJS.value = 0;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboardJS]);

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

  const insetBottom = insets.bottom;
  const sheetStyle = useAnimatedStyle(() => {
    const kb = Math.max(keyboard.height.value, keyboardJS.value);
    return {
      transform: [{ translateY: translateY.value }],
      // With the keyboard up, its height replaces the home-indicator inset
      // (the keyboard already covers that area).
      paddingBottom: kb > 0 ? kb + space.s3 : insetBottom + space.s4,
    };
  });

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.springify().damping(24).stiffness(240)}
        exiting={SlideOutDown.duration(160)}
        style={[
          styles.sheet,
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: theme.border,
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
