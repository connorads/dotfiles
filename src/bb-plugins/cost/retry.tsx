import { useState } from 'react';

/**
 * Runs `onRetry` and ignores clicks until its promise settles, so repeated clicks send one request.
 * `aria-disabled` rather than `disabled` keeps keyboard focus on the button while it runs.
 */
export function Retry({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className="cost-retry" aria-disabled={busy || undefined} onClick={() => {
    if (busy) return;
    setBusy(true);
    void onRetry().finally(() => setBusy(false));
  }}>{busy ? 'Retrying…' : 'Retry'}</button>;
}
