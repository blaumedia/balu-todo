import { lockAsync, OrientationLock, unlockAsync } from 'expo-screen-orientation';
import { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { allowsRotation } from '../lib/layout';

/** Large windows rotate, classic phones stay portrait (iOS: portrait incl. upside-down as the old plist; Android: portrait-up as the old manifest).
 *  Decided by the window's short side, not device idiom. On iOS 27 resizable windows ignore the lock - it is a preference. */
export function useOrientationPolicy(): void {
  const { width, height } = useWindowDimensions();
  const rotate = allowsRotation(width, height);
  useEffect(() => {
    const done = rotate ? unlockAsync() : lockAsync(Platform.OS === 'ios' ? OrientationLock.PORTRAIT : OrientationLock.PORTRAIT_UP);
    done.catch(() => {});
  }, [rotate]);
}
