import { describe, expect, it, vi } from 'vitest';

import { tokenColor } from '../src/components/TokenPill';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock('../src/theme/ThemeProvider', () => ({ useTheme: () => ({}) }));

const theme = {
  tokenDate: 'date',
  tokenProject: 'project',
  tokenLabel: 'label',
  priority1: 'p1',
  priority2: 'p2',
  priority3: 'p3',
} as unknown as Parameters<typeof tokenColor>[2];

describe('tokenColor', () => {
  it('colours a time token like a date', () => {
    expect(tokenColor('time', 0, theme)).toBe('date');
  });
  it('keeps the other token colours', () => {
    expect(tokenColor('start', 0, theme)).toBe('date');
    expect(tokenColor('project', 0, theme)).toBe('project');
    expect(tokenColor('priority', 2, theme)).toBe('p2');
  });
});
