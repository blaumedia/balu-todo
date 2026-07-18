// The completion checkbox — a brand asset (DESIGN §5): ring → fill pops
// (1.0→1.15→1.0) → white check. Haptic + row fade are owned by the caller.
import type { Priority } from '@balu/domain';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { duration } from '../theme/tokens';
import { Icon } from './Icon';

export interface CheckboxProps {
  checked: boolean;
  priority?: Priority;
  onToggle?: () => void;
  size?: number;
}

export function Checkbox({ checked, priority = 0, onToggle, size = 24 }: CheckboxProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const fill = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    if (checked) {
      scale.value = withSequence(
        withTiming(1.15, { duration: duration.fast }),
        withTiming(1, { duration: duration.fast }),
      );
      fill.value = withTiming(1, { duration: duration.medium });
    } else {
      fill.value = withTiming(0, { duration: duration.fast });
    }
  }, [checked, fill, scale]);

  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  const prioColor =
    priority === 1 ? theme.priority1 : priority === 2 ? theme.priority2 : priority === 3 ? theme.priority3 : null;
  const ring = prioColor ?? theme.textTertiary;

  return (
    <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <Animated.View
        style={[
          styles.box,
          { width: size, height: size, borderRadius: 7, borderColor: checked ? theme.accent : ring },
          boxStyle,
        ]}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { borderRadius: 5, backgroundColor: theme.accent }, fillStyle]}
        />
        <Animated.View style={[styles.check, fillStyle]}>
          <View>
            <Icon name="check" size={size * 0.62} color={theme.onAccent} strokeWidth={3} />
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
