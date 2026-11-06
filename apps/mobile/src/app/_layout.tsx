import '../lib/polyfills'; // must run first — installs crypto.randomUUID for the sync client
import { useLastNotificationResponse } from 'expo-notifications';
import { Stack, useNavigationContainerRef, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useSyncExternalStore } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootNotice } from '../components/BootNotice';
import { useOrientationPolicy } from '../hooks/use-orientation-policy';
import { rootViewRef } from '../lib/rootViewRef';
import { ProjectActionsSheet } from '../features/ProjectActionsSheet';
import { QuickAddSheet } from '../features/QuickAddSheet';
import { ScheduleSheet } from '../features/ScheduleSheet';
import { TaskDetailSheet } from '../features/TaskDetailSheet';
import { bootApp, navigateToOnboarding } from '../lib/boot';
import { getSync, subscribeSyncClient } from '../lib/clients';
import { anySheetOpen, subscribeOpenSheets } from '../lib/openSheets';
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
      <View ref={rootViewRef} collapsable={false} style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <Chrome />
          </ThemeProvider>
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}

/** Own component so window size changes re-render only this, not all of Chrome. */
function OrientationPolicy() {
  useOrientationPolicy();
  return null;
}

function Chrome() {
  const scheme = useScheme();
  const theme = useTheme();
  const boot = useApp((s) => s.boot);
  const segments = useSegments();
  const navigationRef = useNavigationContainerRef();
  // While a sheet is open TalkBack must not reach the screen behind it (accessibilityViewIsModal is iOS only).
  // Driven by the sheets that are actually visible, not by store ids (an id can outlive its sheet).
  const sheetOpen = useSyncExternalStore(subscribeOpenSheets, anySheetOpen, anySheetOpen);
  // The single owner of leaving for onboarding once past the index gate (logout,
  // change server, expiry, a lost workspace, a cold deep link): those paths only set
  // boot 'onboarding'. The index gate owns the same step for segments [].
  useEffect(() => {
    leaveForOnboarding(boot, segments, () => navigateToOnboarding(canDismissState(navigationRef.getRootState())));
  }, [boot, segments, navigationRef]);
  return (
    <>
      <OrientationPolicy />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View collapsable={false} style={{ flex: 1 }} importantForAccessibility={sheetOpen ? 'no-hide-descendants' : 'auto'}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="project/[id]" />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
        </Stack>
      </View>
      {/* Global, store-controlled overlays (Modals) above every screen. */}
      <QuickAddSheet />
      <TaskDetailSheet />
      <ScheduleSheet />
      <ProjectActionsSheet />
      <BootNotice />
    </>
  );
}
