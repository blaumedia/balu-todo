// Floating add button — brand-gradient circle, bottom-right above the tab bar or, with the
// Android rail, above the bottom inset
// (DESIGN §7 mobile). Tap creates in the current context.
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';

export function Fab({
  onPress,
  bottom = 24,
  label,
}: {
  onPress: () => void;
  bottom?: number;
  /** Translated accessibility label - callers pass it so screen readers are not English-only. */
  label: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.wrap, { bottom, right: FAB_RIGHT + insets.right, shadowColor: theme.accent }, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={[theme.gradientFrom, theme.gradientTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.circle}
      >
        <Icon name="plus" size={30} color="#fff" strokeWidth={2.5} />
      </LinearGradient>
    </Pressable>
  );
}

const FAB_RIGHT = 20;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  circle: {
    flex: 1,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.96 }] },
});
