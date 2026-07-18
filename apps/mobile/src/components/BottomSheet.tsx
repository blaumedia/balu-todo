// Reusable bottom sheet (DESIGN §7: radius 16, drag handle). Modal-hosted so it
// floats above the tab bar; reanimated slide-in; drag the handle down to dismiss;
// keyboard-aware for the quick-add / detail inputs.
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SlideInDown,
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

  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.container}>
            <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} />
            <Animated.View
              entering={SlideInDown.springify().damping(24).stiffness(240)}
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.surfaceRaised,
                  borderColor: theme.border,
                  paddingBottom: insets.bottom + space.s4,
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
        </KeyboardAvoidingView>
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
