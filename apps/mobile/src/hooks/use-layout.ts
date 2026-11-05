import { useSegments } from 'expo-router';
import { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONTENT_MAX_WIDTH, navRailExtent, screenColumnPadding, type ColumnPadding } from '../lib/layout';

/** Left extent of the navigation rail the tab screens sit beside. Provided by the JS tabs layout
 *  ((tabs)/_layout.tsx); 0 for iOS tabs (NativeTabs) and for root stack screens. */
export const NavRailContext = createContext(0);

/** L/R padding: safe area (Duo rail, cutouts) plus centring in a column of at most maxWidth, right of the Android rail. 0/0 on a portrait phone.
 *  Frame of the nearest SafeAreaProvider, not the window: NativeTabs gives each iOS tab its own provider. */
export function useColumnPadding(maxWidth: number = CONTENT_MAX_WIDTH): ColumnPadding {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const railExtent = useContext(NavRailContext);
  return screenColumnPadding(frame.width, insets.left, insets.right, railExtent, maxWidth);
}

/** Rail extent of the JS tabs for the current window. Always 0 on iOS, where NativeTabs draws its own chrome. */
export function useNavRailExtent(): number {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' ? 0 : navRailExtent(width, insets.left);
}

/** The rail extent while the tabs are the visible screen - for root-level overlays (sheets) that must clear it. */
export function useVisibleNavRailExtent(): number {
  const extent = useNavRailExtent();
  const segments: readonly string[] = useSegments();
  return segments[0] === '(tabs)' ? extent : 0;
}
