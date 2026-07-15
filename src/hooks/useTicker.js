import { useEffect, useState } from 'react';

/* re-render every `ms` while `active`, for the running clock */
export function useTicker(active, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(iv);
  }, [active, ms]);
}
