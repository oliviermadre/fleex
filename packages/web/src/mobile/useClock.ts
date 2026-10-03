import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` (default 30 s — ages are shown in minutes). */
export function useClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
