import { lockAsync, OrientationLock, unlockAsync } from 'expo-screen-orientation';
import { useEffect, useState } from 'react';
import { Dimensions, Platform, type ScaledSize, useWindowDimensions } from 'react-native';
import { rotationAllowedFor } from '../lib/layout';

/** Large windows rotate, classic phones stay portrait (iOS: portrait incl. upside-down as the old plist; Android: portrait-up as the old manifest).
 *  iOS decides by the window's short side, Android by the screen's (see rotationAllowedFor). Not by device idiom.
 *  On iOS 27 resizable windows ignore the lock - it is a preference. */
export function useOrientationPolicy(): void {
  const window = useWindowDimensions();
  const [screen, setScreen] = useState(() => Dimensions.get('screen'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', (e: { screen: ScaledSize }) => setScreen(e.screen));
    return () => sub.remove();
  }, []);
  const rotate = rotationAllowedFor(Platform.OS, window, screen);
  useEffect(() => {
    const done = rotate ? unlockAsync() : lockAsync(Platform.OS === 'ios' ? OrientationLock.PORTRAIT : OrientationLock.PORTRAIT_UP);
    done.catch(() => {});
  }, [rotate]);
}
