/**
 * Large-screen breakpoints, defined once. Pure functions and constants (no
 * react-native import) so they are unit tested. Every function returns the phone
 * result (0 / 'bottom' / false) on a portrait phone, so phones run the same
 * layout as before.
 */

/** Short side of the window from which rotation is allowed (iPad, Duo inner screen, sw600dp tablets). */
export const ROTATION_MIN_SHORT_SIDE = 600;
/** Window width from which sheets become centred cards. */
export const SHEET_CARD_MIN_WINDOW = 600;
/** Window width from which the task detail docks as a side sheet. */
export const SIDE_SHEET_MIN_WINDOW = 900;
export const SHEET_MAX_WIDTH = 600;
export const SIDE_SHEET_MAX_WIDTH = 560;
export const SIDE_SHEET_MIN_WIDTH = 360;
/** Max width of the column of list screens. */
export const CONTENT_MAX_WIDTH = 840;
/** Max width of the column of settings and onboarding. */
export const FORM_MAX_WIDTH = 600;
/**
 * Window width from which the Android JS tabs draw a left navigation rail instead
 * of the bottom bar (Material "medium" width class). Equal to SHEET_CARD_MIN_WINDOW
 * on purpose: a full-width bottom sheet never meets a rail.
 */
export const RAIL_MIN_WINDOW_WIDTH = 600;
export const RAIL_WIDTH = 88;
/** Gap between the FAB and the bottom inset where no bottom bar sits under it (iOS tab screens, Android rail). */
export const FAB_EDGE_GAP = 16;

export interface ColumnPadding {
  left: number;
  right: number;
}

export type SheetLayout = { kind: 'bottom' } | { kind: 'card'; width: number } | { kind: 'side'; width: number };

/** Rotation is decided by the short side, which does not change when the window rotates, so a lock cannot oscillate. */
export function allowsRotation(width: number, height: number): boolean {
  return Math.min(width, height) >= ROTATION_MIN_SHORT_SIDE;
}

/** iOS decides from the window. Android decides from the screen: a large screen that letterboxes a portrait-locked app
 *  shows a narrow window, which would keep the lock forever (a trap). Verified on an API 35 emulator at 800x1280 dp with
 *  ignore-orientation-request on: the letterboxed window was 600x800 while Dimensions 'screen' stayed 1280x800, so the
 *  screen is not shrunk by the letterbox there. Not verified on other OEM builds. */
export function rotationAllowedFor(os: string, window: { width: number; height: number }, screen: { width: number; height: number }): boolean {
  const size = os === 'android' ? screen : window;
  return allowsRotation(size.width, size.height);
}

export function showsNavRail(windowWidth: number): boolean {
  return windowWidth >= RAIL_MIN_WINDOW_WIDTH;
}

/** Width the rail takes from the left window edge: RAIL_WIDTH plus the left inset it absorbs (cutout, left 3-button bar). 0 without a rail. */
export function navRailExtent(windowWidth: number, insetLeft: number): number {
  return showsNavRail(windowWidth) ? RAIL_WIDTH + insetLeft : 0;
}

/** L/R padding that centres a column of at most maxWidth inside the safe area. 0/0 on a portrait phone. */
export function columnPadding(frameWidth: number, insetLeft: number, insetRight: number, maxWidth: number): ColumnPadding {
  const extra = Math.max(0, Math.floor((frameWidth - insetLeft - insetRight - maxWidth) / 2));
  return { left: insetLeft + extra, right: insetRight + extra };
}

/** columnPadding for a screen. Beside the rail (railExtent > 0) the screen starts after the rail and the rail already absorbed the left inset. */
export function screenColumnPadding(
  frameWidth: number,
  insetLeft: number,
  insetRight: number,
  railExtent: number,
  maxWidth: number,
): ColumnPadding {
  return railExtent > 0
    ? columnPadding(frameWidth - railExtent, 0, insetRight, maxWidth)
    : columnPadding(frameWidth, insetLeft, insetRight, maxWidth);
}

/** How a sheet is placed: full-width bottom sheet, centred card, or (task detail only, sideCapable) docked side sheet. */
export function sheetLayout(windowWidth: number, insetLeft: number, insetRight: number, sideCapable: boolean): SheetLayout {
  if (windowWidth < SHEET_CARD_MIN_WINDOW) return { kind: 'bottom' };
  if (sideCapable && windowWidth >= SIDE_SHEET_MIN_WINDOW) {
    // Left edge at half the window (on the Duo: the hinge), or further right to cap the width.
    const left = Math.max(Math.floor(windowWidth / 2), windowWidth - insetRight - SIDE_SHEET_MAX_WIDTH);
    const width = windowWidth - insetRight - left;
    if (width >= SIDE_SHEET_MIN_WIDTH) return { kind: 'side', width };
  }
  return { kind: 'card', width: Math.min(SHEET_MAX_WIDTH, windowWidth - insetLeft - insetRight) };
}
