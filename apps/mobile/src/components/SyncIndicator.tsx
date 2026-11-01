// Ambient sync status (contract §6.3 / DESIGN §1): a quiet dot + label.
import type { SyncStatus } from '@balu/domain';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { syncLabelKey } from '../lib/syncLabel';
import { useTheme } from '../theme/ThemeProvider';
import { font } from '../theme/tokens';

export function SyncIndicator({ status, showLabel = false }: { status: SyncStatus; showLabel?: boolean }) {
  const theme = useTheme();
  const { t } = useT();
  const color =
    status === 'synced'
      ? theme.success
      : status === 'syncing'
        ? theme.accent
        : status === 'error'
          ? theme.danger
          : theme.textTertiary;
  // Read out by screen readers even when the text is not shown (the header shows the dot only).
  const label = t(syncLabelKey(status));
  return (
    <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {showLabel ? <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: font.caption },
});
