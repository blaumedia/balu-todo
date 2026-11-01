import '../lib/polyfills'; // must run first — installs crypto.randomUUID for the sync client
import { useLastNotificationResponse } from 'expo-notifications';
import { Stack, useNavigationContainerRef, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootNotice } from '../components/BootNotice';
import { ProjectActionsSheet } from '../features/ProjectActionsSheet';
import { QuickAddSheet } from '../features/QuickAddSheet';
import { ScheduleSheet } from '../features/ScheduleSheet';
import { TaskDetailSheet } from '../features/TaskDetailSheet';
import { bootApp, navigateToOnboarding } from '../lib/boot';
import { getSync, subscribeSyncClient } from '../lib/clients';
import { canDismissState, leaveForOnboarding } from '../lib/goBack';
import { watchLocaleRetries } from '../lib/localeChoice';
import { configureNotifications, openTaskFromNotification, taskIdFromResponse } from '../lib/notifications';
import { useApp } from '../store/app';
import { ThemeProvider, useScheme, useTheme } from '../theme/ThemeProvider';

/**
 * Anchor of the root Stack: a deep link into a pushed screen (balu://settings,
 * balu://assigned, balu://project/<id>) gets (tabs) beneath it, so hardware Back
 * and the in-app arrow both land on Today instead of exiting the app. The index
 * gate (index.tsx) clears that anchor before it hands over, see leaveGate.
 */
export const unstable_settings = { anchor: '(tabs)' };

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotifications();

export default function RootLayout() {
  // Deep-link a tapped reminder to its task detail (cold-start + warm handled).
  const notificationResponse = useLastNotificationResponse();
  useEffect(() => {
    const taskId = taskIdFromResponse(notificationResponse ?? null);
    if (taskId) openTaskFromNotification(taskId);
  }, [notificationResponse]);

  // Android: a picker dialog restored after activity recreation has lost its
  // JS listener, so OK would silently do nothing. Close any orphan once at mount.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.dismiss('date').catch(() => {});
    DateTimePickerAndroid.dismiss('time').catch(() => {});
  }, []);

  useEffect(() => {
    void bootApp().finally(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
    // Foreground (contract §6.7): sync now and restart the retry backoff from its
    // shortest delay - it may have grown to 30 s while the app was in the background.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getSync()?.wake();
    });
    // A pending language choice is sent again on foreground and once sync is back online.
    const unwatchLocale = watchLocaleRetries({
      onAppStateChange: (cb) => AppState.addEventListener('change', cb),
      subscribeSyncClient,
    });
    return () => {
      sub.remove();
      unwatchLocale();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Chrome />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Chrome() {
  const scheme = useScheme();
  const theme = useTheme();
  const boot = useApp((s) => s.boot);
  const segments = useSegments();
  const navigationRef = useNavigationContainerRef();
  // The single owner of leaving for onboarding once past the index gate (logout,
  // change server, expiry, a lost workspace, a cold deep link): those paths only set
  // boot 'onboarding'. The index gate owns the same step for segments [].
  useEffect(() => {
    leaveForOnboarding(boot, segments, () => navigateToOnboarding(canDismissState(navigationRef.getRootState())));
  }, [boot, segments, navigationRef]);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="project/[id]" />
        <Stack.Screen name="settings" options={{ presentation: 'card' }} />
      </Stack>
      {/* Global, store-controlled overlays (Modals) above every screen. */}
      <QuickAddSheet />
      <TaskDetailSheet />
      <ScheduleSheet />
      <ProjectActionsSheet />
      <BootNotice />
    </>
  );
}
