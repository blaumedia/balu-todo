import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColumnPadding } from '../hooks/use-layout';
import { useT } from '../i18n';
import { goBackOr } from '../lib/goBack';
import { CONTENT_MAX_WIDTH } from '../lib/layout';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, space } from '../theme/tokens';
import { Icon } from './Icon';

/** Header for pushed screens (list / project / label / settings): back + title. */
export function StackHeader({
  title,
  right,
  colorDot,
  backFallback,
  maxWidth = CONTENT_MAX_WIDTH,
}: {
  title: string;
  right?: ReactNode;
  colorDot?: string;
  /** Where Back lands when there is no history (default: Browse; a safety net, the root anchor normally supplies history). */
  backFallback?: Href;
  /** Column width the header aligns with (default: list screens; Settings passes the narrower form width). */
  maxWidth?: number;
}) {
  const theme = useTheme();
  const column = useColumnPadding(maxWidth);
  const { t } = useT();
  return (
    <View style={[styles.row, { paddingLeft: gutter + column.left, paddingRight: gutter + column.right }]}>
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
