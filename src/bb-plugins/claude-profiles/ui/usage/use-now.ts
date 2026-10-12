import { useEffect, useState } from 'react';

/** Re-renders on an interval so countdowns and "updated" times stay true while visible. */
export function useNow(intervalMs: number, active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
