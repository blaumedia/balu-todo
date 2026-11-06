import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { useApp } from '../store/app';
import { dark, light, type ThemeTokens } from './tokens';

interface ThemeCtx {
  theme: ThemeTokens;
  scheme: 'light' | 'dark';
}

const Ctx = createContext<ThemeCtx>({ theme: light, scheme: 'light' });

/** Resolves the user's Theme setting (system|light|dark) against the OS scheme. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const setting = useApp((s) => s.theme);
  const system = useColorScheme();
  const value = useMemo<ThemeCtx>(() => {
    const scheme: 'light' | 'dark' =
      setting === 'system' ? (system === 'dark' ? 'dark' : 'light') : setting;
    return { theme: scheme === 'dark' ? dark : light, scheme };
  }, [setting, system]);

  // iOS: UIKit draws the status bar, the Duo cover rail, the tab bar glass and keyboards from the window's
  // interface style, and with NativeTabs the view controllers ignore the JS status bar style. Pin the window
  // to the chosen theme ('unspecified' = follow the system again). Not on Android: AppCompat would recreate the activity.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    Appearance.setColorScheme(setting === 'system' ? 'unspecified' : setting);
  }, [setting]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeTokens {
  return useContext(Ctx).theme;
}

export function useScheme(): 'light' | 'dark' {
  return useContext(Ctx).scheme;
}
