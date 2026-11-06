import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { REQUIRED, applyToManifest, mergeConfigChanges } = createRequire(import.meta.url)('../plugins/configChanges.js');

const manifestWith = (configChanges?: string) => ({
  application: [{ activity: [{ $: { 'android:name': '.MainActivity', ...(configChanges === undefined ? {} : { 'android:configChanges': configChanges }) } }] }],
});
const flags = (m: ReturnType<typeof manifestWith>): string[] => (m.application[0].activity[0].$ as Record<string, string>)['android:configChanges'].split('|');

describe('mergeConfigChanges', () => {
  it('appends only the missing flags, keeping existing ones in order', () => {
    const out = mergeConfigChanges('keyboard|orientation|screenSize');
    expect(out.split('|').slice(0, 3)).toEqual(['keyboard', 'orientation', 'screenSize']);
    expect(out.split('|').sort()).toEqual([...REQUIRED].sort());
  });

  it('is idempotent and leaves a complete value untouched', () => {
    const once = mergeConfigChanges('keyboard');
    expect(mergeConfigChanges(once)).toBe(once);
    expect(mergeConfigChanges(REQUIRED.join('|'))).toBe(REQUIRED.join('|'));
  });

  it('handles a missing attribute', () => {
    expect(mergeConfigChanges(undefined).split('|').sort()).toEqual([...REQUIRED].sort());
  });
});

describe('applyToManifest', () => {
  it('adds density to a MainActivity without the attribute', () => {
    const m = manifestWith();
    applyToManifest(m);
    expect(flags(m)).toContain('density');
  });

  it('throws when MainActivity is missing', () => {
    expect(() => applyToManifest({ application: [{ activity: [] }] })).toThrow(/MainActivity/);
    expect(() => applyToManifest({})).toThrow(/MainActivity/);
  });
});
