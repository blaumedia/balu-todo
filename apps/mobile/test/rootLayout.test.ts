import { describe, expect, it, vi } from 'vitest';

import { unstable_settings } from '../src/app/_layout';

// Only the exported route settings are under test; every import of the layout is stubbed.
vi.mock('../src/lib/polyfills', () => ({}));
vi.mock('expo-notifications', () => ({ useLastNotificationResponse: () => null }));
vi.mock('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: () => null }), useSegments: () => [] }));
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => Promise.resolve(),
  hideAsync: () => Promise.resolve(),
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react', () => ({ useEffect: () => {} }));
vi.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: {} }));
vi.mock('react-native', () => ({ AppState: {}, Platform: { OS: 'android' } }));
vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: () => null }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: () => null }));
vi.mock('../src/components/BootNotice', () => ({ BootNotice: () => null }));
vi.mock('../src/features/ProjectActionsSheet', () => ({ ProjectActionsSheet: () => null }));
vi.mock('../src/features/QuickAddSheet', () => ({ QuickAddSheet: () => null }));
vi.mock('../src/features/ScheduleSheet', () => ({ ScheduleSheet: () => null }));
vi.mock('../src/features/TaskDetailSheet', () => ({ TaskDetailSheet: () => null }));
vi.mock('../src/lib/boot', () => ({ bootApp: async () => {}, navigateToOnboarding: () => {} }));
vi.mock('../src/lib/clients', () => ({ getSync: () => null, subscribeSyncClient: () => () => {} }));
vi.mock('../src/lib/goBack', () => ({ leaveForOnboarding: () => false }));
vi.mock('../src/lib/localeChoice', () => ({ watchLocaleRetries: () => () => {} }));
vi.mock('../src/hooks/use-orientation-policy', () => ({ useOrientationPolicy: () => {} }));
vi.mock('../src/store/app', () => ({ useApp: () => 'loading' }));
vi.mock('../src/lib/notifications', () => ({
  configureNotifications: () => {},
  openTaskFromNotification: () => {},
  taskIdFromResponse: () => null,
}));
vi.mock('../src/theme/ThemeProvider', () => ({
  ThemeProvider: () => null,
  useScheme: () => 'light',
  useTheme: () => ({}),
}));

describe('root layout', () => {
  it('anchors the root Stack on (tabs) so deep links get a tab below them', () => {
    expect(unstable_settings).toEqual({ anchor: '(tabs)' });
  });
});
