import type { IsoDate, Label } from '@balu/domain';
import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en, type TranslationKey } from '../src/i18n/en';
import { moreLabelsText, rowDate, rowLabels } from '../src/lib/rowMeta';

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

describe('rowDate', () => {
  const today = '2026-05-10' as IsoDate;
  const d = (start: string | null, deadline: string | null, hide: boolean) =>
    rowDate({ start_date: start as IsoDate | null, deadline: deadline as IsoDate | null }, today, 'en', tOf(en), hide);

  it('hides the today chip only when hideToday is set', () => {
    expect(d(today, null, true)).toBeNull();
    expect(d(today, null, false)?.info.tone).toBe('today');
  });
  it('always shows overdue and future dates', () => {
    expect(d('2026-05-01', null, true)?.info.tone).toBe('overdue');
    expect(d('2026-05-20', null, true)?.info.tone).not.toBe('today');
    expect(d('2026-05-20', null, true)).not.toBeNull();
  });
  it('marks a deadline-only task and returns null without any date', () => {
    expect(d(null, '2026-05-20', false)?.isDeadlineOnly).toBe(true);
    expect(d('2026-05-20', '2026-06-01', false)?.isDeadlineOnly).toBe(false);
    expect(d(null, null, false)).toBeNull();
  });
  it('prefers the start date over the deadline', () => {
    expect(d(today, '2026-05-20', false)?.info.tone).toBe('today');
    expect(d(today, '2026-05-20', true)).toBeNull();
  });
});
