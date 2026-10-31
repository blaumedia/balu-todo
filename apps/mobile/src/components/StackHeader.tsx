import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { goBackOr } from '../lib/goBack';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, space } from '../theme/tokens';
import { Icon } from './Icon';

/** Header for pushed screens (list / project / label / settings): back + title. */
export function StackHeader({
  title,
  right,
  colorDot,
  backFallback,
}: {
  title: string;
  right?: ReactNode;
  colorDot?: string;
  /** Where Back lands when there is no history (default: Browse). */
  backFallback?: Href;
}) {
  const theme = useTheme();
  const { t } = useT();
  return (
    <View style={styles.row}>
      <Pressable onPress={() => goBackOr(backFallback)} hitSlop={10} accessibilityLabel={t('common.back')}>
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
