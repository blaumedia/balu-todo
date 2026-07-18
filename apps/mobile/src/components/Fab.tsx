// Floating add button — brand-gradient circle, bottom-right above the tab bar
// (DESIGN §7 mobile). Tap creates in the current context.
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';

export function Fab({ onPress, bottom = 24 }: { onPress: () => void; bottom?: number }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add task"
      style={({ pressed }) => [styles.wrap, { bottom, shadowColor: theme.accent }, pressed && styles.pressed]}
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

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 20,
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
