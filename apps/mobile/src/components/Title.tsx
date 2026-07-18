import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, space } from '../theme/tokens';

/** Sheet & dialog title (DESIGN §3 title). */
export function Title({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.title, { color: theme.textPrimary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: font.weightSemibold, paddingBottom: space.s2 },
});
