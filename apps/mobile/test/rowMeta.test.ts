import type { Label } from '@balu/domain';
import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en, type TranslationKey } from '../src/i18n/en';
import { moreLabelsText, rowLabels } from '../src/lib/rowMeta';

const mk = (id: string, deleted = false) => [id, { id, name: id, color: null, is_deleted: deleted } as unknown as Label] as const;
const labels = new Map([mk('a'), mk('b'), mk('c'), mk('gone', true)]);

describe('rowLabels', () => {
  it('shows up to two labels with no overflow chip', () => {
    expect(rowLabels(['a'], labels)).toMatchObject({ overflow: 0 });
    const r = rowLabels(['a', 'b'], labels);
    expect(r.visible.map((l) => l.id)).toEqual(['a', 'b']);
    expect(r.overflow).toBe(0);
  });
  it('collapses labels beyond two into a count', () => {
    const r = rowLabels(['a', 'b', 'c'], labels);
    expect(r.visible.map((l) => l.id)).toEqual(['a', 'b']);
    expect(r.overflow).toBe(1);
  });
  it('skips deleted and unknown labels before counting', () => {
    const r = rowLabels(['a', 'gone', 'nope', 'b', 'c'], labels);
    expect(r.visible.map((l) => l.id)).toEqual(['a', 'b']);
    expect(r.overflow).toBe(1);
    expect(rowLabels(['gone', 'nope'], labels)).toEqual({ visible: [], overflow: 0 });
  });
});

const tOf = (d: Record<TranslationKey, string>) => (k: TranslationKey) => d[k];

describe('moreLabelsText', () => {
  it('uses the singular for one hidden label and the plural otherwise, in both locales', () => {
    expect(moreLabelsText(1, tOf(en))).toBe('1 more label');
    expect(moreLabelsText(3, tOf(en))).toBe('3 more labels');
    expect(moreLabelsText(1, tOf(de))).toBe('1 weiteres Label');
    expect(moreLabelsText(2, tOf(de))).toBe('2 weitere Labels');
  });
});
