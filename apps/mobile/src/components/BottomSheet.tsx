// Reusable bottom sheet (DESIGN §7: radius 16, drag handle). Modal-hosted so it
// floats above the tab bar; reanimated slide-in; drag the handle down to dismiss;
// keyboard-aware for the quick-add / detail inputs.
//
// Keyboard handling: KeyboardAvoidingView is unreliable inside a Modal, and RN's
// JS Keyboard events can mis-report there too. So the sheet padding is driven by
// Reanimated's native keyboard tracker, with the JS Keyboard events kept as a
// fallback — whichever mechanism reports a height wins.
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SlideInDown,
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.container}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} />
          <Animated.View
            entering={SlideInDown.springify().damping(24).stiffness(240)}
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
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s5,
  },
  handleArea: { alignItems: 'center', paddingVertical: space.s3 },
  handle: { width: 36, height: 4, borderRadius: 2 },
});
