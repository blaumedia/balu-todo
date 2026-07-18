import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, space } from '../theme/tokens';
import { Icon } from './Icon';

/** Header for pushed screens (list / project / label / settings): back + title. */
export function StackHeader({ title, right, colorDot }: { title: string; right?: ReactNode; colorDot?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
        <Icon name="arrow-left" size={24} color={theme.textPrimary} strokeWidth={2} />
      </Pressable>
      {colorDot ? <View style={[styles.dot, { backgroundColor: colorDot }]} /> : null}
      <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingHorizontal: gutter,
    paddingTop: space.s2,
    paddingBottom: space.s3,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  title: { fontSize: font.display, fontWeight: font.weightSemibold, letterSpacing: -0.5, flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
});
