import type { RefObject } from 'react';
import type { ViewInstance } from 'react-native';

// The app's full-screen root view: the View directly inside GestureHandlerRootView
// in app/_layout (GestureHandlerRootView itself does not accept a ref).
// useKeyboardReveal measures it to find the keyboard top in the same
// coordinate system as an input's measureInWindow position.
export const rootViewRef = { current: null } as RefObject<ViewInstance | null>;
