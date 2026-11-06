import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module keeps a counter, so every test gets a fresh copy and none depends on another's cleanup.
async function load() {
  return import('../src/lib/openSheets');
}

describe('openSheets', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is open only while a sheet is registered', async () => {
    const { anySheetOpen, registerOpenSheet } = await load();
    expect(anySheetOpen()).toBe(false);
    const a = registerOpenSheet();
    const b = registerOpenSheet();
    expect(anySheetOpen()).toBe(true);
    a();
    expect(anySheetOpen()).toBe(true);
    b();
    expect(anySheetOpen()).toBe(false);
  });

  it('unregistering twice does not underflow the count', async () => {
    const { anySheetOpen, registerOpenSheet } = await load();
    const a = registerOpenSheet();
    a();
    a();
    const b = registerOpenSheet();
    expect(anySheetOpen()).toBe(true);
    b();
    expect(anySheetOpen()).toBe(false);
  });

  it('notifies subscribers on every change until unsubscribed', async () => {
    const { registerOpenSheet, subscribeOpenSheets } = await load();
    const fn = vi.fn();
    const off = subscribeOpenSheets(fn);
    const a = registerOpenSheet();
    a();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    registerOpenSheet()();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
