import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { Icon } from './Icon';

/** The "..." trigger for a row or header action sheet. */
export function MoreButton({ onPress, label }: { onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.5 }]}
    >
      <Icon name="more-horizontal" size={20} color={theme.textTertiary} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({ btn: { padding: space.s1 } });
