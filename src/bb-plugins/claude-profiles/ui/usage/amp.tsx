import { useEffect, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import type { AmpOverview } from '../../src/accounts/usage/amp-reading.ts';
import { readingAge } from '../../src/accounts/usage/format.ts';

export function AmpUsage({ open, refreshToken, now }: { open: boolean; refreshToken: number; now: Date }) {
  const rpc = useRpc<typeof rpcContract>();
  const lastRefresh = useRef(refreshToken);
  const [value, setValue] = useState<AmpOverview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setMessage(null);
    const refresh = refreshToken !== lastRefresh.current;
    lastRefresh.current = refreshToken;
    void rpc.call('usage.amp', { refresh }).then(next => {
      if (active) setValue(next);
    }).catch(() => {
      if (active) setMessage('Amp usage could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, refreshToken, rpc]);
  return <section className="au-provider" role="region" aria-label="Amp usage" aria-busy={loading}>
    <h3 className="au-provider-heading">Amp</h3>
    {loading && <p className="au-reading">Checking Amp…</p>}
    {message && <p className="au-account-message">{message}</p>}
    {value?.machines.map(machine => <section className="au-provider-card" key={machine.hostId}>
      <div className="au-account">
      {value.machines.length > 1 && <h4 className="au-account-name">{machine.hostName}</h4>}
      {machine.reading.status === 'ok' ? <>
        <p className="au-native-usage">{machine.reading.text}</p>
        <p className="au-reading">{readingAge(machine.reading.observedAt, now)}</p>
        {machine.message && <p className="au-account-message">Showing previous reading. {machine.message}</p>}
      </> : <p className="au-account-message">{machine.reading.message}</p>}
      </div>
    </section>)}
  </section>;
}
