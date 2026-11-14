import { useState } from 'react';

/** Runs `onRetry` and stays disabled until its promise settles, so repeated clicks send one request. */
export function Retry({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className="cost-retry" disabled={busy} onClick={() => {
    setBusy(true);
    void onRetry().finally(() => setBusy(false));
  }}>{busy ? 'Retrying…' : 'Retry'}</button>;
}
