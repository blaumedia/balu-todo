// Haptics wrapper (DESIGN §5 — light on complete, medium on drop; mobile only).
// Fails silently on platforms/devices without a haptics engine.
import * as Haptics from 'expo-haptics';

export function hapticComplete(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticDrop(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticSelect(): void {
  Haptics.selectionAsync().catch(() => {});
}
