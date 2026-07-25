import { ApiError } from '@balu/api-client';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useT, type TranslationKey } from '../i18n';
import { establishSession } from '../lib/boot';
import { apiBase, getApi, initApi } from '../lib/clients';
import { hasExplicitScheme, isInsecureUrl, normalizeUrl, toInsecureUrl } from '../lib/serverUrl';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, radius, space } from '../theme/tokens';

export default function Onboarding() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const serverUrl = useApp((s) => s.serverUrl);
  const setServerUrl = useApp((s) => s.setServerUrl);
  // "Change server" clears the stored URL; keep the last value so the input
  // is pre-filled for editing instead of starting from scratch.
  const lastServerUrl = useRef(serverUrl);
  if (serverUrl) lastServerUrl.current = serverUrl;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <LinearGradient colors={[theme.gradientFrom, theme.gradientTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
            <Icon name="check" size={34} color="#fff" strokeWidth={3} />
          </LinearGradient>
          <Text style={[styles.wordmark, { color: theme.textPrimary }]}>{t('onboarding.title')}</Text>
          <Text style={[styles.tagline, { color: theme.textSecondary }]}>{t('onboarding.tagline')}</Text>
        </View>

        {serverUrl ? (
          <AuthStep serverUrl={serverUrl} onChangeServer={() => setServerUrl(null)} />
        ) : (
          <ServerStep initialValue={lastServerUrl.current ?? ''} onConfirm={setServerUrl} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ServerStep({ initialValue, onConfirm }: { initialValue: string; onConfirm: (url: string) => void }) {
  const theme = useTheme();
  const { t } = useT();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Plain http is only used after the user acknowledges it explicitly.
  const [insecureUrl, setInsecureUrl] = useState<string | null>(null);
  // Set when an assumed https:// couldn't connect — offers the http:// retry.
  const [httpFallback, setHttpFallback] = useState<string | null>(null);

  const submit = async (confirmedInsecure = false) => {
    setHttpFallback(null);
    const url = normalizeUrl(value);
    if (!url) {
      setError(t('onboarding.badUrl'));
      return;
    }
    if (isInsecureUrl(url) && !confirmedInsecure) {
      setError(null);
      setInsecureUrl(url);
      return;
    }
    setInsecureUrl(null);
    setBusy(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${url}/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('bad status');
      onConfirm(url); // persists + advances to auth
    } catch {
      // A bare hostname was silently upgraded to https. Reporting only "couldn't
      // reach that server" hides that we changed what they typed — most
      // self-hosted Balu instances on a LAN are plain http, so name the URL we
      // actually tried and offer the http:// alternative in one tap.
      if (!hasExplicitScheme(value) && !isInsecureUrl(url)) {
        setHttpFallback(toInsecureUrl(url));
        setError(t('onboarding.unreachableHttps').replace('{url}', url));
      } else {
        setError(t('onboarding.unreachable'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>{t('onboarding.serverTitle')}</Text>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>{t('onboarding.serverHint')}</Text>
      <Field
        icon="server"
        placeholder={t('onboarding.serverPlaceholder')}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          setInsecureUrl(null); // editing the URL re-arms the confirmation
          setHttpFallback(null);
          setError(null); // a stale failure shouldn't sit under the new address
        }}
        autoCapitalize="none"
        keyboardType="url"
        theme={theme}
      />
      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      {httpFallback ? (
        <Pressable
          onPress={() => {
            // Put the http:// form in the field and jump straight to the
            // existing "unencrypted connection" confirmation.
            setValue(httpFallback);
            setError(null);
            setHttpFallback(null);
            setInsecureUrl(httpFallback);
          }}
        >
          <Text style={[styles.retryLink, { color: theme.accent }]}>
            {t('onboarding.tryHttp').replace('{url}', httpFallback)}
          </Text>
        </Pressable>
      ) : null}
      {insecureUrl ? (
        <View style={[styles.warning, { borderColor: theme.danger }]}>
          <Text style={[styles.warningTitle, { color: theme.danger }]}>
            {t('onboarding.insecureTitle')}
          </Text>
          <Text style={[styles.hint, { color: theme.textSecondary }]}>
            {t('onboarding.insecureWarning')}
          </Text>
        </View>
      ) : null}
      <Button
        title={insecureUrl ? t('onboarding.continueInsecure') : t('onboarding.continue')}
        variant="gradient"
        onPress={() => void submit(insecureUrl != null)}
        loading={busy}
        style={{ marginTop: space.s4 }}
      />
    </View>
  );
}

function AuthStep({ serverUrl, onChangeServer }: { serverUrl: string; onChangeServer: () => void }) {
  const theme = useTheme();
  const { t } = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const api = initApi(serverUrl);
    try {
      if (mode === 'register') {
        await api.register({ email: email.trim(), password, name: name.trim() });
      } else {
        await api.login({ email: email.trim(), password });
      }
      const client = getApi();
      if (client) await establishSession(serverUrl, client);
      router.replace('/today');
    } catch (e) {
      const code = e instanceof ApiError ? (`auth.${e.code}` as TranslationKey) : 'auth.errorGeneric';
      // `rate_limited` included so a throttled user is told to wait rather than
      // being sent back to re-check a password that was fine.
      const known = ['auth.invalid_credentials', 'auth.email_taken', 'auth.registration_disabled', 'auth.rate_limited'];
      setError(t(known.includes(code) ? code : 'auth.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>
        {mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
      </Text>
      <Pressable onPress={onChangeServer} style={styles.serverChip}>
        <Icon name="server" size={13} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.serverText, { color: theme.textTertiary }]} numberOfLines={1}>
          {apiBase(serverUrl).replace('/api/v1', '')}
        </Text>
        {isInsecureUrl(serverUrl) ? (
          <Text style={[styles.insecureBadge, { color: theme.danger }]}>
            {t('onboarding.insecureBadge')}
          </Text>
        ) : null}
        <Text style={[styles.changeLink, { color: theme.accent }]}>{t('onboarding.changeServer')}</Text>
      </Pressable>

      {mode === 'register' ? (
        <Field icon="settings" placeholder={t('auth.name')} value={name} onChangeText={setName} theme={theme} />
      ) : null}
      <Field icon="server" placeholder={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" theme={theme} hideIcon />
      <Field icon="server" placeholder={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry theme={theme} hideIcon />
      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

      <Button
        title={mode === 'login' ? t('auth.login') : t('auth.register')}
        variant="gradient"
        onPress={submit}
        loading={busy}
        disabled={!email.trim() || !password || (mode === 'register' && !name.trim())}
        style={{ marginTop: space.s4 }}
      />
      <Pressable onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }} style={styles.switchMode}>
        <Text style={[styles.switchText, { color: theme.accent }]}>
          {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
        </Text>
      </Pressable>
    </View>
  );
}

function Field({
  icon,
  theme,
  hideIcon,
  ...props
}: {
  icon: 'server' | 'settings';
  theme: ReturnType<typeof useTheme>;
  hideIcon?: boolean;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {!hideIcon ? <Icon name={icon} size={18} color={theme.textTertiary} strokeWidth={2} /> : null}
      <TextInput style={[styles.input, { color: theme.textPrimary }]} placeholderTextColor={theme.textTertiary} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: gutter, gap: space.s6 },
  brand: { alignItems: 'center', gap: space.s2 },
  logo: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: space.s2 },
  wordmark: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  tagline: { fontSize: font.secondary },
  form: { gap: space.s3 },
  stepTitle: { fontSize: font.title, fontWeight: font.weightSemibold },
  hint: { fontSize: font.secondary, marginBottom: space.s2, lineHeight: font.secondary * 1.4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.s3, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space.s4, minHeight: 50 },
  input: { flex: 1, fontSize: font.body },
  error: { fontSize: font.secondary },
  retryLink: { fontSize: font.secondary, fontWeight: font.weightMedium, marginTop: -space.s1 },
  warning: { borderWidth: 1, borderRadius: radius.control, padding: space.s3, gap: space.s2 },
  warningTitle: { fontSize: font.secondary, fontWeight: font.weightSemibold },
  insecureBadge: { fontSize: font.caption, fontWeight: font.weightMedium },
  serverChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.s2 },
  serverText: { fontSize: font.caption, flexShrink: 1 },
  changeLink: { fontSize: font.caption, fontWeight: font.weightMedium, marginLeft: 'auto' },
  switchMode: { alignItems: 'center', paddingVertical: space.s3 },
  switchText: { fontSize: font.secondary, fontWeight: font.weightMedium },
  switch: {},
});
