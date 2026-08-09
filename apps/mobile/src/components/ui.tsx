import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, hit, radius, space } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

/** Large view title (DESIGN §3 display) with an optional right accessory. */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Uppercase, tracked caption section header (DESIGN §3 caption).
 *  `numberOfLines` is opt-in: headers that share their row with an accessory
 *  need to truncate rather than push it off-screen. */
export function SectionHeader({ children, numberOfLines }: { children: string; numberOfLines?: number }) {
  const theme = useTheme();
  return (
    <Text style={[styles.section, { color: theme.textTertiary }]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function EmptyState({ text, icon }: { text: string; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      {icon ? <Icon name={icon} size={32} color={theme.textTertiary} strokeWidth={1.75} /> : null}
      <Text style={[styles.emptyText, { color: theme.textTertiary }]}>{text}</Text>
    </View>
  );
}

export interface ListRowProps {
  label: string;
  icon?: IconName;
  colorDot?: string;
  count?: number;
  badge?: number;
  onPress?: () => void;
  right?: ReactNode;
  chevron?: boolean;
}

/** A Browse / navigation row (the web sidebar item, as a screen row). */
export function ListRow({ label, icon, colorDot, count, badge, onPress, right, chevron }: ListRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: theme.accentWash }]}
    >
      {icon ? <Icon name={icon} size={20} color={theme.accent} strokeWidth={2} /> : null}
      {colorDot ? <View style={[styles.listDot, { backgroundColor: colorDot }]} /> : null}
      <Text style={[styles.listLabel, { color: theme.textPrimary }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.listRight}>
        {badge != null && badge > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <Text style={[styles.badgeText, { color: theme.onAccent }]}>{badge}</Text>
          </View>
        ) : count != null ? (
          <Text style={[styles.count, { color: theme.textTertiary }]}>{count}</Text>
        ) : null}
        {right}
        {chevron ? <Icon name="chevron-right" size={18} color={theme.textTertiary} strokeWidth={2} /> : null}
      </View>
    </Pressable>
  );
}

export function Divider({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }, style]} />;
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: gutter,
    paddingTop: space.s2,
    paddingBottom: space.s3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3,
  },
  title: { fontSize: font.display, fontWeight: font.weightSemibold, letterSpacing: -0.5, flex: 1 },
  section: {
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    letterSpacing: font.trackingCaption,
    textTransform: 'uppercase',
    paddingHorizontal: gutter,
    paddingTop: space.s5,
    paddingBottom: space.s2,
  },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 96, gap: space.s3 },
  emptyText: { fontSize: font.body, fontWeight: font.weightMedium },
  listRow: {
    minHeight: hit + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingHorizontal: gutter,
    paddingVertical: space.s3,
  },
  listDot: { width: 12, height: 12, borderRadius: 6 },
  listLabel: { fontSize: font.body, flex: 1 },
  listRight: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  count: { fontSize: font.secondary, fontVariant: ['tabular-nums'] },
  badge: { minWidth: 22, height: 22, borderRadius: radius.pill, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: font.caption, fontWeight: font.weightSemibold, fontVariant: ['tabular-nums'] },
});
