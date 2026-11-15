import { useEffect, useRef, useState } from 'react';
import { refresh } from './store.ts';

/** Reloads profiles once at a time and says so while it runs. */
export function Retry() {
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function retry() {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    try { await refresh(); }
    finally { busy.current = false; if (mounted.current) setRunning(false); }
  }
  return <button type="button" className="cc-link" aria-disabled={running || undefined} aria-busy={running || undefined}
    onClick={() => void retry()}>{running ? 'Retrying…' : 'Retry'}</button>;
}
