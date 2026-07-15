import { useEffect } from 'react';

/* keep the screen on while a match is live; re-acquire when the app
   returns to the foreground (the lock is released on backgrounding) */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock = null;
    let disposed = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {}
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !disposed) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) { try { lock.release(); } catch {} }
    };
  }, [active]);
}
