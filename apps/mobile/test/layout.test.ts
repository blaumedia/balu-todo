import { describe, expect, it } from 'vitest';
import {
  allowsRotation,
  rotationAllowedFor,
  columnPadding,
  navRailExtent,
  RAIL_MAX_WIDTH,
  RAIL_WIDTH,
  railWidth,
  bottomBarHeight,
  fabBottomBarOffset,
  screenColumnPadding,
  sheetLayout,
  showsNavRail,
} from '../src/lib/layout';

describe('allowsRotation', () => {
  it.each([
    [402, 874],
    [440, 956],
    [956, 440],
    [466, 678],
    [599, 900],
    [412, 915],
  ])('keeps phones and narrow windows portrait (%i x %i)', (w, h) => {
    expect(allowsRotation(w, h)).toBe(false);
  });
  it.each([
    [600, 960],
    [960, 600],
    [669, 951],
    [951, 669],
    [744, 1133],
    [1032, 1376],
    [800, 1280],
    [1280, 800],
  ])('rotates large windows (%i x %i)', (w, h) => {
    expect(allowsRotation(w, h)).toBe(true);
  });
});

describe('rotationAllowedFor', () => {
  const phone = { width: 412, height: 915 };
  const tabletScreen = { width: 800, height: 1280 };
  const letterbox = { width: 560, height: 1280 }; // narrow portrait window on a landscape-held large screen
  it('iOS follows the window', () => {
    expect(rotationAllowedFor('ios', phone, tabletScreen)).toBe(false);
    expect(rotationAllowedFor('ios', tabletScreen, phone)).toBe(true);
  });
  it('Android follows the screen, so a letterboxed window cannot trap the lock', () => {
    expect(rotationAllowedFor('android', letterbox, tabletScreen)).toBe(true);
    expect(rotationAllowedFor('android', tabletScreen, phone)).toBe(false);
    expect(rotationAllowedFor('android', phone, phone)).toBe(false);
  });
});

describe('showsNavRail', () => {
  it.each([360, 412, 599])('no rail on phones and narrow split windows (%i)', (w) => {
    expect(showsNavRail(w)).toBe(false);
  });
  // 700 is a landscape split window with a short side below 600: documents the width-not-short-side choice.
  it.each([600, 800, 960, 1280, 700])('rail from 600 wide (%i)', (w) => {
    expect(showsNavRail(w)).toBe(true);
  });
});

describe('navRailExtent', () => {
  it.each([
    [412, 0, 0],
    [599, 24, 0],
    [600, 0, 88],
    [1280, 0, 88],
    [960, 48, 136], // left cutout absorbed
  ])('(%i, %i) -> %i', (w, inset, expected) => {
    expect(navRailExtent(w, inset, 1)).toBe(expected);
  });
  it('grows with the font scale and the cutout is added on top', () => {
    expect(navRailExtent(800, 0, 2)).toBe(176);
    expect(navRailExtent(960, 48, 1.3)).toBe(114 + 48);
    expect(navRailExtent(412, 0, 2)).toBe(0); // phones: no rail at any scale
  });
});

describe('railWidth', () => {
  it.each([
    [0.85, 88],
    [1, 88],
    [1.15, 101],
    [1.3, 114],
    [1.5, 132],
    [2, 176],
    [3, 176],
    [Number.NaN, 88],
  ])('font scale %f -> %i', (scale, expected) => {
    expect(railWidth(scale)).toBe(expected);
  });
  it('stays within [RAIL_WIDTH, RAIL_MAX_WIDTH]', () => {
    for (let s = 0.5; s <= 4; s += 0.05) {
      expect(railWidth(s)).toBeGreaterThanOrEqual(RAIL_WIDTH);
      expect(railWidth(s)).toBeLessThanOrEqual(RAIL_MAX_WIDTH);
    }
  });
});

describe('columnPadding', () => {
  it.each([
    [402, 0, 0, 840, { left: 0, right: 0 }],
    [1376, 0, 0, 840, { left: 268, right: 268 }],
    [1032, 0, 0, 840, { left: 96, right: 96 }],
    [1001, 0, 0, 840, { left: 80, right: 80 }],
    [951, 84, 0, 840, { left: 97, right: 13 }],
    [466, 0, 84, 840, { left: 0, right: 84 }],
    [669, 0, 0, 600, { left: 34, right: 34 }],
  ])('(%i, %i, %i, %i)', (frame, l, r, max, expected) => {
    expect(columnPadding(frame, l, r, max)).toEqual(expected);
  });
});

describe('screenColumnPadding', () => {
  it.each([
    [412, 0, 0, 0, 840, { left: 0, right: 0 }], // Android phone, unchanged
    [1032, 0, 0, 0, 840, { left: 96, right: 96 }], // no rail = columnPadding
    [951, 84, 0, 0, 840, { left: 97, right: 13 }], // no rail = columnPadding
    [600, 0, 0, RAIL_WIDTH, 840, { left: 0, right: 0 }],
    [800, 0, 0, RAIL_WIDTH, 840, { left: 0, right: 0 }],
    [960, 0, 0, RAIL_WIDTH, 840, { left: 16, right: 16 }],
    [1280, 0, 0, RAIL_WIDTH, 840, { left: 176, right: 176 }],
    [960, 48, 0, RAIL_WIDTH + 48, 840, { left: 0, right: 0 }], // left inset not counted twice
    [960, 0, 48, RAIL_WIDTH, 840, { left: 0, right: 48 }],
    [1280, 0, 0, RAIL_WIDTH, 600, { left: 296, right: 296 }],
  ])('(%i, %i, %i, %i, %i)', (frame, l, r, rail, max, expected) => {
    expect(screenColumnPadding(frame, l, r, rail, max)).toEqual(expected);
  });
});

describe('sheetLayout', () => {
  it.each([
    [402, 0, 0, true, { kind: 'bottom' }],
    [599, 0, 0, true, { kind: 'bottom' }],
    [466, 0, 84, true, { kind: 'bottom' }],
    [669, 0, 0, true, { kind: 'card', width: 600 }],
    [744, 0, 0, false, { kind: 'card', width: 600 }],
    [1376, 0, 0, false, { kind: 'card', width: 600 }],
    [1376, 0, 0, true, { kind: 'side', width: 560 }],
    [1032, 0, 0, true, { kind: 'side', width: 516 }],
    [951, 84, 0, true, { kind: 'side', width: 476 }],
    [951, 0, 84, true, { kind: 'side', width: 392 }],
    [960, 0, 0, true, { kind: 'side', width: 480 }],
    [900, 0, 200, true, { kind: 'card', width: 600 }], // side too narrow, falls back
    [600, RAIL_WIDTH, 0, true, { kind: 'card', width: 512 }], // 7" portrait over the rail
    [600, 0, 0, true, { kind: 'card', width: 600 }], // 7" portrait over a stack screen
    [800, RAIL_WIDTH, 0, false, { kind: 'card', width: 600 }],
    [960, RAIL_WIDTH, 0, true, { kind: 'side', width: 480 }],
    [1280, RAIL_WIDTH, 0, true, { kind: 'side', width: 560 }],
  ])('(%i, %i, %i, %s)', (w, l, r, side, expected) => {
    expect(sheetLayout(w, l, r, side)).toEqual(expected);
  });
  it('never shows a bottom sheet next to a rail', () => {
    for (const w of [360, 412, 599, 600, 800, 960, 1280]) {
      expect(showsNavRail(w)).toBe(sheetLayout(w, 0, 0, false).kind !== 'bottom');
    }
  });
});

describe('bottomBarHeight / fabBottomBarOffset', () => {
  it.each([
    [0.85, 49, 64],
    [1, 49, 64],
    [1.15, 52, 67],
    [1.3, 54, 69],
    [2, 65, 80],
    [Number.NaN, 49, 64],
  ])('font scale %f -> bar %i, FAB offset %i', (scale, bar, fab) => {
    expect(bottomBarHeight(scale)).toBe(bar);
    expect(fabBottomBarOffset(scale)).toBe(fab);
  });
  it('is the unchanged phone bar at scale 1 and below, and never shrinks', () => {
    for (let s = 0.5; s <= 1; s += 0.05) expect(bottomBarHeight(s)).toBe(49);
    for (let s = 1; s <= 3; s += 0.05) expect(bottomBarHeight(s + 0.05)).toBeGreaterThanOrEqual(bottomBarHeight(s));
  });
});
