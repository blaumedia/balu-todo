import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { useSnapshot } from '../store/useSnapshot';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { Icon } from './Icon';
import { SyncIndicator } from './SyncIndicator';

/** Right-side header accessory shown on tab screens: ambient sync + settings. */
export function HeaderActions() {
  const theme = useTheme();
  const { t } = useT();
  const snap = useSnapshot();
  return (
    <View style={styles.row}>
      <SyncIndicator status={snap.status} />
      <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel={t('settings.title')}>
        <Icon name="settings" size={22} color={theme.textSecondary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
});
