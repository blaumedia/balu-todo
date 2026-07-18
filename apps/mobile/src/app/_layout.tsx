import '../lib/polyfills'; // must run first — installs crypto.randomUUID for the sync client
import { useLastNotificationResponse } from 'expo-notifications';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QuickAddSheet } from '../features/QuickAddSheet';
import { ScheduleSheet } from '../features/ScheduleSheet';
import { TaskDetailSheet } from '../features/TaskDetailSheet';
import { bootApp } from '../lib/boot';
import { getSync } from '../lib/clients';
import { configureNotifications, openTaskFromNotification, taskIdFromResponse } from '../lib/notifications';
import { ThemeProvider, useScheme, useTheme } from '../theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotifications();

export default function RootLayout() {
  // Deep-link a tapped reminder to its task detail (cold-start + warm handled).
  const notificationResponse = useLastNotificationResponse();
  useEffect(() => {
    const taskId = taskIdFromResponse(notificationResponse ?? null);
    if (taskId) openTaskFromNotification(taskId);
  }, [notificationResponse]);

  useEffect(() => {
    void bootApp().finally(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
    // Foreground sync (contract §6.7): pull whenever the app becomes active.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getSync()?.sync();
    });
    return () => sub.remove();
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
    </>
  );
}
