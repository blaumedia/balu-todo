import type { Locale, McpSettings, Theme } from '@balu/domain';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
// `Clipboard` is deprecated in react-native core but still shipped, and it is the
// only clipboard this app can use without pulling in a native module and forcing
// a new dev-client/store build for a copy button.
import {
  Alert,
  Clipboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { StackHeader } from '../components/StackHeader';
import { SectionHeader } from '../components/ui';
import { getApi } from '../lib/clients';
import { logout, switchWorkspace } from '../lib/boot';
import { requestReminderPermission, startReminderScheduler, stopReminderScheduler } from '../lib/notifications';
import { useT } from '../i18n';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, radius, space } from '../theme/tokens';

/**
 * The `balu_mcp_` prefix followed by a fixed run of dots. Fixed, not
 * proportional: the masked form should not hint at the key's length, and it has
 * to render identically to the web client's.
 */
function maskKey(key: string): string {
  const prefix = 'balu_mcp_';
  return `${key.startsWith(prefix) ? prefix : ''}${'\u2022'.repeat(16)}`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const user = useApp((s) => s.user);
  const workspace = useApp((s) => s.workspace);
  const memberships = useApp((s) => s.memberships);
  const serverUrl = useApp((s) => s.serverUrl);
  const themeSetting = useApp((s) => s.theme);
  const locale = useApp((s) => s.locale);
  const setTheme = useApp((s) => s.setTheme);
  const setLocale = useApp((s) => s.setLocale);
  const setUser = useApp((s) => s.setUser);
  const setServerUrl = useApp((s) => s.setServerUrl);
  const setContext = useApp((s) => s.setContext);
  const remindersEnabled = useApp((s) => s.remindersEnabled);
  const setRemindersEnabled = useApp((s) => s.setRemindersEnabled);

  const [name, setName] = useState(user?.name ?? '');
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Null until the server answers. A 404 means this instance runs without
  // BALU_MCP_ENABLED (or predates the feature) - either way the section stays hidden.
  const [mcp, setMcp] = useState<McpSettings | null>(null);
  const [mcpRevealed, setMcpRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // The state flag only drives the dimming: two taps in the same frame both read
  // the same stale `switching` from their render closure, so the actual
  // re-entry guard has to be a ref that is set synchronously.
  const switchingRef = useRef(false);

  useEffect(() => {
    getApi()
      ?.getMcpSettings()
      .then(setMcp)
      .catch(() => setMcp(null));
  }, []);

  const copyValue = (field: string, value: string) => {
    Clipboard.setString(value);
    setCopied(field);
    setTimeout(() => setCopied((c) => (c === field ? null : c)), 1500);
  };

  const storeKey = () => {
    getApi()
      ?.generateMcpKey()
      .then((next) => {
        setMcp(next);
        setMcpRevealed(false);
      })
      .catch(() => Alert.alert(t('auth.errorGeneric')));
  };

  const generateMcpKey = () => {
    // Replacing a key breaks live connections; minting the first one cannot.
    if (!mcp?.key) {
      storeKey();
      return;
    }
    Alert.alert(t('mcp.regenerate'), t('mcp.regenerateConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mcp.regenerate'), style: 'destructive', onPress: storeKey },
    ]);
  };

  const toggleReminders = async (next: boolean) => {
    if (!next) {
      setRemindersEnabled(false);
      stopReminderScheduler();
      setPermissionDenied(false);
      return;
    }
    const granted = await requestReminderPermission();
    if (granted) {
      setPermissionDenied(false);
      setRemindersEnabled(true);
      startReminderScheduler();
    } else {
      setPermissionDenied(true);
      setRemindersEnabled(false);
    }
  };

  const doSwitch = async (id: string) => {
    if (switchingRef.current || id === workspace?.id) return;
    switchingRef.current = true;
    setSwitching(true);
    try {
      const ok = await switchWorkspace(id);
      if (!ok) {
        Alert.alert(t('workspace.switchError'));
        return;
      }
      // Everything under this screen still belongs to the old workspace: a
      // project screen would re-set the compose context to a foreign project id
      // when it regains focus, and the next quick-add would be rejected by the
      // server. Reset the context and collapse the stack back to the tabs, which
      // set the context themselves on focus.
      setContext({ kind: 'list', list: 'today' });
      if (router.canDismiss()) router.dismissAll();
    } catch {
      Alert.alert(t('workspace.switchError'));
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  };

  const bestEffortPatch = (body: Partial<{ name: string; locale: Locale; theme: Theme }>) => {
    getApi()?.patchMe(body).catch(() => {});
  };

  const saveName = () => {
    const v = name.trim();
    if (!v || v === user?.name) return;
    if (user) setUser({ ...user, name: v });
    bestEffortPatch({ name: v });
  };

  const changeTheme = (value: Theme) => {
    setTheme(value);
    bestEffortPatch({ theme: value });
  };
  const changeLocale = (value: Locale) => {
    setLocale(value);
    bestEffortPatch({ locale: value });
  };

  const doLogout = async () => {
    await logout();
    router.replace('/onboarding');
  };
  const changeServer = async () => {
    await logout();
    setServerUrl(null);
    router.replace('/onboarding');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <StackHeader title={t('settings.title')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Account */}
        <SectionHeader>{t('settings.account')}</SectionHeader>
        <View style={styles.card}>
          <View style={[styles.field, { borderBottomColor: theme.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{t('settings.name')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              onBlur={saveName}
              onSubmitEditing={saveName}
              style={[styles.fieldInput, { color: theme.textPrimary }]}
              returnKeyType="done"
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{t('settings.email')}</Text>
            <Text style={[styles.fieldValue, { color: theme.textTertiary }]}>{user?.email ?? '—'}</Text>
          </View>
        </View>
        {/* Workspace */}
        {memberships.length > 0 || workspace ? (
          <>
            <SectionHeader>{t('settings.workspace')}</SectionHeader>
            <View style={[styles.card, switching && { opacity: 0.6 }]}>
              {memberships.length > 0
                ? memberships.map((m, i) => {
                    const active = m.workspace.id === workspace?.id;
                    return (
                      <Pressable
                        key={m.workspace.id}
                        onPress={() => doSwitch(m.workspace.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active, disabled: switching }}
                        style={({ pressed }) => [
                          styles.wsRow,
                          i < memberships.length - 1 && {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: theme.border,
                          },
                          pressed && !active && { backgroundColor: theme.accentWash },
                        ]}
                      >
                        <Text
                          style={[styles.wsName, { color: active ? theme.accent : theme.textPrimary }]}
                          numberOfLines={1}
                        >
                          {m.workspace.name}
                        </Text>
                        {active ? <Icon name="check" size={18} color={theme.accent} strokeWidth={2} /> : null}
                      </Pressable>
                    );
                  })
                : // Offline boot: the cached session has no membership list, so show
                  // the current workspace on its own rather than hiding the section.
                  workspace ? (
                    <View style={styles.wsRow} accessibilityState={{ selected: true }}>
                      <Text style={[styles.wsName, { color: theme.accent }]} numberOfLines={1}>
                        {workspace.name}
                      </Text>
                      <Icon name="check" size={18} color={theme.accent} strokeWidth={2} />
                    </View>
                  ) : null}
            </View>
          </>
        ) : null}

        {/* Appearance */}
        <SectionHeader>{t('settings.appearance')}</SectionHeader>
        <View style={styles.card}>
          <View style={[styles.field, { borderBottomColor: theme.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{t('settings.theme')}</Text>
          </View>
          <View style={styles.segmentRow}>
            {(
              [
                ['system', 'settings', 'theme.system'],
                ['light', 'sun', 'theme.light'],
                ['dark', 'moon', 'theme.dark'],
              ] as [Theme, IconName, 'theme.system' | 'theme.light' | 'theme.dark'][]
            ).map(([value, icon, key]) => {
              const active = themeSetting === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => changeTheme(value)}
                  style={[styles.seg, { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accentWash : 'transparent' }]}
                >
                  <Icon name={icon} size={18} color={active ? theme.accent : theme.textSecondary} strokeWidth={2} />
                  <Text style={[styles.segText, { color: active ? theme.accent : theme.textSecondary }]}>{t(key)}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.field, { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{t('settings.locale')}</Text>
          </View>
          <View style={styles.segmentRow}>
            {(
              [
                ['en', 'English'],
                ['de', 'Deutsch'],
              ] as [Locale, string][]
            ).map(([value, label]) => {
              const active = locale === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => changeLocale(value)}
                  style={[styles.seg, { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accentWash : 'transparent' }]}
                >
                  <Text style={[styles.segText, { color: active ? theme.accent : theme.textSecondary }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Notifications */}
        <SectionHeader>{t('settings.notifications')}</SectionHeader>
        <View style={styles.card}>
          <View style={styles.field}>
            <Icon name="bell" size={18} color={theme.textTertiary} strokeWidth={2} />
            <Text style={[styles.fieldLabel, { color: theme.textSecondary, width: undefined, flex: 1, marginLeft: space.s2 }]}>
              {t('settings.reminders')}
            </Text>
            <Switch
              value={remindersEnabled}
              onValueChange={toggleReminders}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor="#fff"
            />
          </View>
        </View>
        <Text style={[styles.note, { color: permissionDenied ? theme.danger : theme.textTertiary }]}>
          {permissionDenied ? t('settings.remindersDenied') : t('settings.remindersHint')}
        </Text>

        {/* Claude / MCP */}
        {mcp ? (
          <>
            <SectionHeader>{t('settings.mcp')}</SectionHeader>
            <Text style={[styles.note, { color: theme.textTertiary, paddingBottom: space.s2 }]}>
              {t('mcp.subtitle')}
            </Text>
            <View style={styles.card}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary, width: undefined }]}>{t('mcp.endpoint')}</Text>
              <Pressable onPress={() => copyValue('endpoint', mcp.endpoint)} style={styles.monoRow}>
                <Text style={[styles.mono, { color: theme.textPrimary }]} numberOfLines={1}>
                  {mcp.endpoint}
                </Text>
                <Icon name={copied === 'endpoint' ? 'check' : 'copy'} size={16} color={theme.accent} strokeWidth={2} />
              </Pressable>

              {mcp.key == null ? (
                <Text style={[styles.note, { color: theme.textTertiary, paddingHorizontal: 0 }]}>{t('mcp.noKey')}</Text>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: theme.textSecondary, width: undefined, marginTop: space.s3 }]}>
                    {t('mcp.key')}
                  </Text>
                  <View style={styles.monoRow}>
                    <Text style={[styles.mono, { color: theme.textPrimary }]} numberOfLines={1}>
                      {mcpRevealed ? mcp.key : maskKey(mcp.key)}
                    </Text>
                    <Pressable
                      onPress={() => setMcpRevealed((v) => !v)}
                      accessibilityLabel={mcpRevealed ? t('mcp.hide') : t('mcp.reveal')}
                      hitSlop={8}
                    >
                      <Icon name={mcpRevealed ? 'eye-off' : 'eye'} size={16} color={theme.accent} strokeWidth={2} />
                    </Pressable>
                    <Pressable
                      onPress={() => copyValue('key', mcp.key ?? '')}
                      accessibilityLabel={t('common.copy')}
                      hitSlop={8}
                    >
                      <Icon name={copied === 'key' ? 'check' : 'copy'} size={16} color={theme.accent} strokeWidth={2} />
                    </Pressable>
                  </View>

                  <Text style={[styles.fieldLabel, { color: theme.textSecondary, width: undefined, marginTop: space.s3 }]}>
                    {t('mcp.hint')}
                  </Text>
                  <Pressable
                    onPress={() => copyValue('command', mcp.claude_code_command ?? '')}
                    style={styles.monoRow}
                  >
                    <Text style={[styles.mono, { color: theme.textPrimary }]} numberOfLines={2}>
                      {mcpRevealed
                        ? mcp.claude_code_command
                        : mcp.claude_code_command?.replace(mcp.key, maskKey(mcp.key))}
                    </Text>
                    <Icon name={copied === 'command' ? 'check' : 'copy'} size={16} color={theme.accent} strokeWidth={2} />
                  </Pressable>
                </>
              )}
            </View>
            <Pressable onPress={generateMcpKey} style={styles.linkRow}>
              <Icon
                name={mcp.key == null ? 'key' : 'refresh-cw'}
                size={16}
                color={mcp.key == null ? theme.accent : theme.danger}
                strokeWidth={2}
              />
              <Text style={[styles.link, { color: mcp.key == null ? theme.accent : theme.danger }]}>
                {t(mcp.key == null ? 'mcp.generate' : 'mcp.regenerate')}
              </Text>
            </Pressable>
            {mcp.key == null ? null : (
              <Text style={[styles.note, { color: theme.textTertiary }]}>{t('mcp.regenerateHint')}</Text>
            )}
          </>
        ) : null}

        {/* Server */}
        <SectionHeader>{t('settings.server')}</SectionHeader>
        <View style={styles.card}>
          <View style={styles.field}>
            <Icon name="server" size={18} color={theme.textTertiary} strokeWidth={2} />
            <Text style={[styles.fieldValue, { color: theme.textPrimary, marginLeft: space.s2 }]} numberOfLines={1}>
              {serverUrl ?? '—'}
            </Text>
          </View>
        </View>
        <Pressable onPress={changeServer} style={styles.linkRow}>
          <Icon name="smartphone" size={16} color={theme.accent} strokeWidth={2} />
          <Text style={[styles.link, { color: theme.accent }]}>{t('onboarding.changeServer')}</Text>
        </Pressable>

        <Button title={t('settings.logout')} variant="secondary" danger onPress={doLogout} style={{ marginTop: space.s6 }} />
        <View style={{ height: space.s8 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, paddingBottom: 40 },
  card: { borderRadius: radius.card, overflow: 'hidden' },
  field: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.s3, borderBottomWidth: 0 },
  fieldLabel: { fontSize: font.secondary, width: 90 },
  fieldInput: { flex: 1, fontSize: font.body, textAlign: 'right' },
  fieldValue: { flex: 1, fontSize: font.body, textAlign: 'right' },
  note: { fontSize: font.caption, paddingHorizontal: space.s1, paddingTop: space.s2 },
  wsRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingVertical: space.s3 },
  wsName: { flex: 1, minWidth: 0, fontSize: font.body },
  segmentRow: { flexDirection: 'row', gap: space.s2, paddingVertical: space.s2 },
  seg: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: space.s3, borderWidth: 1, borderRadius: radius.control },
  segText: { fontSize: font.secondary, fontWeight: font.weightMedium },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.s3, paddingHorizontal: space.s1 },
  monoRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingVertical: space.s2 },
  // `Menlo` exists only on iOS; Android silently falls back to a proportional face.
  mono: { flex: 1, fontSize: font.caption, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  link: { fontSize: font.secondary, fontWeight: font.weightMedium },
});
