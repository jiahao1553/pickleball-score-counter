/* Vibration feedback. iOS Safari has never implemented the Vibration API
   (deliberate WebKit limitation) — navigator.vibrate is simply absent
   there, so haptics silently no-op on iPhone/iPad. */
export const HAPTIC_SUPPORTED =
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let enabled = true;
export function setHapticEnabled(on) { enabled = on; }

export function buzz(pattern) {
  if (enabled && HAPTIC_SUPPORTED) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

export const hap = {
  tap: () => buzz(12),
  point: () => buzz([28, 30, 40]),
  gain: () => buzz([28, 30, 40, 30, 60]),
  sideout: () => buzz(70),
  second: () => buzz([20, 25, 20]),
  win: () => buzz([60, 50, 60, 50, 160]),
};
