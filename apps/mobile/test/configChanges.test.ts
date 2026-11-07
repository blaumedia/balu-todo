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
  it('removes density from a template that has it, keeping the other flags in order', () => {
    const merged = mergeConfigChanges('keyboard|density|uiMode').split('|');
    expect(merged).not.toContain('density');
    expect(merged.slice(0, 2)).toEqual(['keyboard', 'uiMode']);
  });

  it('rewrites a complete template that also carries density', () => {
    expect(mergeConfigChanges([...REQUIRED, 'density'].join('|'))).toBe(REQUIRED.join('|'));
    expect(mergeConfigChanges('density')).toBe(REQUIRED.join('|'));
  });
});

describe('applyToManifest', () => {
  it('adds the size flags to a MainActivity without the attribute', () => {
    const m = manifestWith();
    applyToManifest(m);
    expect(flags(m)).toEqual(expect.arrayContaining(['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']));
  });

  it('does not handle density: a live size + density pair needs the activity recreated', () => {
    expect(REQUIRED).not.toContain('density');
    const m = manifestWith();
    applyToManifest(m);
    expect(flags(m)).not.toContain('density');
  });

  it('throws when MainActivity is missing', () => {
    expect(() => applyToManifest({ application: [{ activity: [] }] })).toThrow(/MainActivity/);
    expect(() => applyToManifest({})).toThrow(/MainActivity/);
  });
});
