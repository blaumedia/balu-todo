// Reusable bottom sheet (DESIGN §7: radius 16, drag handle). On windows at least 600
// wide it is a centred card (max 600), and with `full` from 900 a side sheet docked on
// the right; over the tabs on an Android tablet cards clear the navigation rail (the
// scrim still covers it). Rendered as a
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
// - The slide-in is a manual spring on the offset (translateY, translateX for the side sheet), not an entering()
//   animation, for the same reason.
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useVisibleNavRailExtent } from '../hooks/use-layout';
import { sheetLayout } from '../lib/layout';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { AndroidKeyboardSpacer } from './AndroidKeyboardSpacer';

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

export function BottomSheet({ visible, onClose, children, full }: BottomSheetProps) {
  const { t } = useT();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(SLIDE_FROM);
  const keyboardHeight = useKeyboardHeight();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Over the tabs on an Android tablet the rail takes the left edge (it already contains insets.left).
  const insetLeft = Math.max(insets.left, useVisibleNavRailExtent());
  const layout = sheetLayout(windowWidth, insetLeft, insets.right, full === true);
  const side = layout.kind === 'side';
  // bottom: the historical 700 (phones unchanged); card: tablets are taller than 700; side: from the right edge.
  const slideFrom = layout.kind === 'bottom' ? SLIDE_FROM : side ? layout.width + insets.right : Math.max(SLIDE_FROM, windowHeight);

  useEffect(() => {
    if (visible) {
      offset.value = slideFrom;
      offset.value = withSpring(0, { damping: 24, stiffness: 240 });
    }
    // A resize while open must not replay the entrance, so slideFrom is not a dependency.
  }, [visible, offset]); // eslint-disable-line react-hooks/exhaustive-deps

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
      offset.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        offset.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() =>
    side ? { transform: [{ translateX: offset.value }] } : { transform: [{ translateY: offset.value }] },
  );

  if (!visible) return null;

  // With the keyboard up, its height replaces the home-indicator inset (the
  // keyboard already covers that area). On Android the lift comes from the
  // AndroidKeyboardSpacer instead — the event height is unusable there.
  const bottomPad =
    Platform.OS !== 'android' && keyboardHeight > 0
      ? keyboardHeight + space.s3
      : insets.bottom + space.s4;

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={() => {
        Keyboard.dismiss();
        onClose();
      }}
      style={[StyleSheet.absoluteFill, styles.container, !side && { paddingLeft: insetLeft, paddingRight: insets.right }]}
    >
      <Animated.View entering={FadeIn.duration(150)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
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
          layout.kind === 'card' ? { width: layout.width, alignSelf: 'center' } : null,
          side ? [styles.side, { right: insets.right, width: layout.width, paddingTop: insets.top + space.s3 }] : null,
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: theme.border,
            paddingBottom: bottomPad,
            maxHeight: side ? undefined : full ? '92%' : '88%',
            minHeight: side ? undefined : full ? '70%' : undefined,
          },
          sheetStyle,
        ]}
      >
        {side ? null : (
          <GestureDetector gesture={pan}>
            <View style={styles.handleArea}>
              <View style={[styles.handle, { backgroundColor: theme.border }]} />
            </View>
          </GestureDetector>
        )}
        {children}
        <AndroidKeyboardSpacer bottomInset={insets.bottom} animated />
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
  side: { position: 'absolute', top: 0, bottom: 0, borderTopRightRadius: 0, borderBottomLeftRadius: radius.sheet },
  handleArea: { alignItems: 'center', paddingVertical: space.s3 },
  handle: { width: 36, height: 4, borderRadius: 2 },
});
