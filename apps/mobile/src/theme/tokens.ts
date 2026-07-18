// Balu design tokens for React Native — transcribed from
// .claude/skills/balu-design/tokens/*.css (DESIGN.md §2–5).
// Light/dark are the same token *names* with different values; components never
// reference raw hex, only `theme.<token>`.

export interface ThemeTokens {
  // Semantic surfaces
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  // Accent
  accent: string;
  accentHover: string;
  accentWash: string;
  accentHoverWash: string;
  onAccent: string;
  // Semantic status
  danger: string;
  warning: string;
  success: string;
  // Priority hues (P3 == accent, none == no color)
  priority1: string;
  priority2: string;
  priority3: string;
  // Quick-add token pill hues
  tokenDate: string;
  tokenProject: string;
  tokenLabel: string;
  // Scrim behind sheets
  overlay: string;
  // Brand gradient stops
  gradientFrom: string;
  gradientTo: string;
}

export const light: ThemeTokens = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E2E8F0',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  accent: '#0284C7', // balu-600 — AA on white
  accentHover: '#0369A1',
  accentWash: '#F0F9FF',
  accentHoverWash: '#E0F2FE',
  onAccent: '#FFFFFF',
  danger: '#DC2626',
  warning: '#D97706',
  success: '#16A34A',
  priority1: '#DC2626',
  priority2: '#D97706',
  priority3: '#0284C7',
  tokenDate: '#0284C7',
  tokenProject: '#7C3AED',
  tokenLabel: '#B45309',
  overlay: 'rgba(15, 23, 42, 0.4)',
  gradientFrom: '#2563EB',
  gradientTo: '#06B6D4',
};

export const dark: ThemeTokens = {
  bg: '#0B1120',
  surface: '#151E31',
  surfaceRaised: '#1C2740',
  border: '#2A3650',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  accent: '#38BDF8', // balu-400
  accentHover: '#7DD3FC',
  accentWash: 'rgba(12, 74, 110, 0.35)',
  accentHoverWash: 'rgba(12, 74, 110, 0.5)',
  onAccent: '#082F49',
  danger: '#F87171',
  warning: '#FBBF24',
  success: '#4ADE80',
  priority1: '#F87171',
  priority2: '#FBBF24',
  priority3: '#38BDF8',
  tokenDate: '#38BDF8',
  tokenProject: '#A78BFA',
  tokenLabel: '#FBBF24',
  overlay: 'rgba(2, 6, 20, 0.6)',
  gradientFrom: '#2563EB',
  gradientTo: '#06B6D4',
};

// ── Theme-independent scales (spacing.css / typography.css / motion.css) ──

export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
} as const;

export const radius = {
  chip: 6,
  control: 10,
  card: 12,
  sheet: 16,
  pill: 999,
} as const;

export const gutter = 16; // mobile screen gutter
export const rowMin = 46; // task row density (DESIGN §4)
export const hit = 44; // min touch target

export const font = {
  display: 28, // view titles (mobile pt)
  title: 20, // sheet & dialog titles
  body: 17, // task titles — the workhorse
  secondary: 15, // notes preview, metadata
  caption: 13, // chips, section headers
  weightRegular: '400' as const,
  weightMedium: '500' as const,
  weightSemibold: '600' as const,
  trackingCaption: 0.4,
  leadingBody: 1.4,
};

export const duration = {
  fast: 120,
  medium: 200,
  nav: 280,
  complete: 600,
} as const;

// ── Project / label hue palette (contract §3.1 `color` enum) ──
export const projectColors: Record<string, string> = {
  slate: '#64748B',
  red: '#EF4444',
  orange: '#F97316',
  amber: '#F59E0B',
  green: '#22C55E',
  teal: '#14B8A6',
  cyan: '#06B6D4',
  blue: '#3B82F6',
  indigo: '#6366F1',
  violet: '#8B5CF6',
  pink: '#EC4899',
  rose: '#F43F5E',
};

export function projectHex(color: string | undefined | null): string {
  return (color && projectColors[color]) || projectColors.slate;
}
