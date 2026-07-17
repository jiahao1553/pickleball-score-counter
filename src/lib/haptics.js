/* Vibration feedback. iOS Safari has never implemented the Vibration API
   (deliberate WebKit limitation) — navigator.vibrate is simply absent
   there, so haptics silently no-op on iPhone/iPad.

   On Android, navigator.vibrate() is rejected (returns false) until the
   page has user activation — which touch screens only grant at
   pointerUP / touchend, while the score zones fire on pointerdown. A
   rejected pattern is therefore queued and replayed by a persistent
   listener on the activation-granting events, so at worst the first
   tap's buzz lands at finger lift. */
export const HAPTIC_SUPPORTED =
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let enabled = true;
let pendingPattern = null;

export function setHapticEnabled(on) { enabled = on; }

export function buzz(pattern) {
  if (!enabled || !HAPTIC_SUPPORTED) return;
  try {
    const ok = navigator.vibrate(pattern);
    if (!ok) pendingPattern = pattern;
  } catch {
    pendingPattern = pattern;
  }
}

if (HAPTIC_SUPPORTED && typeof document !== 'undefined') {
  ['pointerup', 'touchend'].forEach((ev) =>
    document.addEventListener(ev, () => {
      if (pendingPattern === null) return;
      const p = pendingPattern;
      pendingPattern = null;
      try { navigator.vibrate(p); } catch {}
    }, { capture: true, passive: true }));
}

export const hap = {
  tap: () => buzz(12),
  point: () => buzz([28, 30, 40]),
  gain: () => buzz([28, 30, 40, 30, 60]),
  sideout: () => buzz(70),
  second: () => buzz([20, 25, 20]),
  win: () => buzz([60, 50, 60, 50, 160]),
};
