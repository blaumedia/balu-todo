import { describe, expect, it, vi } from 'vitest';
import { anySheetOpen, registerOpenSheet, subscribeOpenSheets } from '../src/lib/openSheets';

describe('openSheets', () => {
  it('is open only while a sheet is registered', () => {
    expect(anySheetOpen()).toBe(false);
    const a = registerOpenSheet();
    const b = registerOpenSheet();
    expect(anySheetOpen()).toBe(true);
    a();
    expect(anySheetOpen()).toBe(true);
    b();
    expect(anySheetOpen()).toBe(false);
  });

  it('unregistering twice does not underflow the count', () => {
    const a = registerOpenSheet();
    a();
    a();
    const b = registerOpenSheet();
    expect(anySheetOpen()).toBe(true);
    b();
    expect(anySheetOpen()).toBe(false);
  });

  it('notifies subscribers on every change until unsubscribed', () => {
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
