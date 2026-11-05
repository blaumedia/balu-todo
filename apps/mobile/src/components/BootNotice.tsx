import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { logout } from '../lib/boot';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import { font, space } from '../theme/tokens';
import { Button } from './Button';

/**
 * Full-screen notice while lib/boot.ts keeps asking /me after the open workspace
 * was lost (`reconnecting`) or when the account has no workspace (`noWorkspace`).
 * Covers whatever screen was open - its edits would be dropped - and offers the
 * logout as the way out.
 */
export function BootNotice() {
  const boot = useApp((s) => s.boot);
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  if (boot !== 'reconnecting' && boot !== 'noWorkspace') return null;
  const noWorkspace = boot === 'noWorkspace';
  return (
    <View
      accessibilityRole="alert"
      style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: space.s6 + insets.left, paddingRight: space.s6 + insets.right }]}
    >
      {noWorkspace ? null : <ActivityIndicator color={theme.accent} />}
      <Text style={[styles.title, { color: theme.textPrimary }]}>
        {t(noWorkspace ? 'boot.noWorkspaceTitle' : 'boot.reconnectingTitle')}
      </Text>
      <Text style={[styles.body, { color: theme.textSecondary }]}>
        {t(noWorkspace ? 'boot.noWorkspaceBody' : 'boot.reconnectingBody')}
      </Text>
      <Button title={t('settings.logout')} variant="secondary" onPress={() => void logout()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: space.s4, padding: space.s6 },
  title: { fontSize: font.title, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: font.body, textAlign: 'center', maxWidth: 360 },
});
