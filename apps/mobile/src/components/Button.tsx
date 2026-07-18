import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius } from '../theme/tokens';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'gradient' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, danger, style }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  if (variant === 'gradient') {
    return (
      <Pressable onPress={onPress} disabled={isDisabled} style={[styles.wrap, style, isDisabled && styles.dim]}>
        <LinearGradient
          colors={[theme.gradientFrom, theme.gradientTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.base}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.label, { color: '#fff' }]}>{title}</Text>}
        </LinearGradient>
      </Pressable>
    );
  }

  const bg =
    variant === 'primary' ? (danger ? theme.danger : theme.accent) : variant === 'secondary' ? theme.surface : 'transparent';
  const border = variant === 'secondary' ? theme.border : 'transparent';
  const fg =
    variant === 'primary' ? theme.onAccent : danger ? theme.danger : variant === 'ghost' ? theme.accent : theme.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.base, { backgroundColor: bg, borderColor: border, borderWidth: variant === 'secondary' ? 1 : 0 }, style, isDisabled && styles.dim]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.label, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.control, overflow: 'hidden' },
  base: {
    minHeight: 48,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: { fontSize: font.body, fontWeight: font.weightSemibold },
  dim: { opacity: 0.5 },
});
