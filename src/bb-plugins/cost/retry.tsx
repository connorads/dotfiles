import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Runs `onRetry` and ignores clicks until its promise settles, so repeated clicks send one request.
 * `aria-disabled` rather than `disabled` keeps keyboard focus on the button while it runs.
 * `onRetry` resolves `true` only when its own request failed; a reply that a newer load superseded counts as nothing.
 * The note beside the button counts those failures, and its changing text re-announces the alert around it.
 * When a success removes the focused button, focus moves to the nearest `[data-retry-home]` ancestor, not the page body.
 * The ancestor is focusable only until focus leaves it, so a later click inside it never moves the Tab start.
 */
export function Retry({ onRetry }: { onRetry: () => Promise<boolean> }) {
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
      if (!home) return;
      queueMicrotask(() => {
        if (!home.isConnected) return;
        home.tabIndex = -1;
        home.addEventListener('blur', () => home.removeAttribute('tabindex'), { once: true });
        home.focus({ preventScroll: true });
      });
    };
  }, []);
  return <span className="cost-retry-group">
    <button ref={button} type="button" className="cost-retry" aria-disabled={busy || undefined} onClick={() => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      void onRetry().then(failed => { if (failed) setFailures(count => count + 1); }).finally(() => { running.current = false; setBusy(false); });
    }}>{busy ? 'Retrying…' : 'Retry'}</button>
    {failures > 0 && !busy && <span className="cost-retry-note">
      Still failing after {failures} {failures === 1 ? 'retry' : 'retries'}.</span>}
  </span>;
}
