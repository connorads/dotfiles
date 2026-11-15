import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Runs `onRetry` and ignores clicks until its promise settles, so repeated clicks send one request.
 * `aria-disabled` rather than `disabled` keeps keyboard focus on the button while it runs.
 * A successful load removes the failure this button sits in, so a retry that settles with the button still
 * on screen failed again: the note beside it counts those, and its changing text re-announces the alert around it.
 * When a success removes the focused button, focus moves to the nearest `[data-retry-home]` ancestor, not the page body.
 */
export function Retry({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  // Clicks in one task all see the same render, so the guard is a ref, not the `busy` state.
  const running = useRef(false);
  useLayoutEffect(() => {
    const node = button.current;
    return () => {
      if (!node || node !== node.ownerDocument.activeElement) return;
      const home = node.parentElement?.closest<HTMLElement>('[data-retry-home]');
      if (home) queueMicrotask(() => { if (home.isConnected) home.focus({ preventScroll: true }); });
    };
  }, []);
  return <span className="cost-retry-group">
    <button ref={button} type="button" className="cost-retry" aria-disabled={busy || undefined} onClick={() => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      void onRetry().finally(() => { running.current = false; setBusy(false); setFailures(count => count + 1); });
    }}>{busy ? 'Retrying…' : 'Retry'}</button>
    {failures > 0 && !busy && <span className="cost-retry-note">
      Still failing after {failures} {failures === 1 ? 'retry' : 'retries'}.</span>}
  </span>;
}
