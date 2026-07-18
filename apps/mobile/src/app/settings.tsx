import type { Locale, Theme } from '@balu/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { StackHeader } from '../components/StackHeader';
import { SectionHeader } from '../components/ui';
import { getApi } from '../lib/clients';
import { logout } from '../lib/boot';
import { requestReminderPermission, startReminderScheduler, stopReminderScheduler } from '../lib/notifications';
import { useT } from '../i18n';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, radius, space } from '../theme/tokens';

export default function SettingsScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const user = useApp((s) => s.user);
  const workspace = useApp((s) => s.workspace);
  const serverUrl = useApp((s) => s.serverUrl);
  const themeSetting = useApp((s) => s.theme);
  const locale = useApp((s) => s.locale);
  const setTheme = useApp((s) => s.setTheme);
  const setLocale = useApp((s) => s.setLocale);
  const setUser = useApp((s) => s.setUser);
  const setServerUrl = useApp((s) => s.setServerUrl);
  const remindersEnabled = useApp((s) => s.remindersEnabled);
  const setRemindersEnabled = useApp((s) => s.setRemindersEnabled);

  const [name, setName] = useState(user?.name ?? '');
  const [permissionDenied, setPermissionDenied] = useState(false);

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
        {workspace ? (
          <Text style={[styles.note, { color: theme.textTertiary }]}>
            {t('settings.workspace')}: {workspace.name}
          </Text>
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
  segmentRow: { flexDirection: 'row', gap: space.s2, paddingVertical: space.s2 },
  seg: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: space.s3, borderWidth: 1, borderRadius: radius.control },
  segText: { fontSize: font.secondary, fontWeight: font.weightMedium },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.s3, paddingHorizontal: space.s1 },
  link: { fontSize: font.secondary, fontWeight: font.weightMedium },
});
