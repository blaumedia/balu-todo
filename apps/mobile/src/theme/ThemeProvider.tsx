import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeTokens {
  return useContext(Ctx).theme;
}

export function useScheme(): 'light' | 'dark' {
  return useContext(Ctx).scheme;
}
