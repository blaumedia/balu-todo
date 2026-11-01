import { describe, expect, it, vi } from 'vitest';

import { SyncIndicator } from '../src/components/SyncIndicator';

// The component is called as a plain function: it only builds an element tree.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock('../src/i18n', () => ({
  useT: () => ({
    t: (k: string) => (k === 'sync.offline' ? 'Offline - saved locally' : k),
    locale: 'en',
  }),
}));
vi.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({ success: 'g', accent: 'a', danger: 'r', textTertiary: 't' }),
}));

describe('SyncIndicator', () => {
  it('is one accessible element labelled with the status, even without the text label', () => {
    const el = SyncIndicator({ status: 'offline' });
    expect(el.props.accessible).toBe(true);
    expect(el.props.accessibilityLabel).toBe('Offline - saved locally');
  });
});
