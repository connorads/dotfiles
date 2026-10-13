import { useEffect, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import type { AmpOverview } from '../../src/accounts/usage/amp-reading.ts';
import { Icon } from '../components/ui/icon.tsx';
import { presentAmpUsage } from '../../src/accounts/usage/amp-presentation.ts';
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
    <h3 className="au-provider-heading"><Icon name="Zap" className="size-3.5" />Amp</h3>
    {loading && <p className="au-reading">Checking Amp…</p>}
    {message && <p className="au-account-message">{message}</p>}
    {value?.machines.map(machine => {
      const reading = machine.reading;
      const presentation = reading.status === 'ok' ? presentAmpUsage(reading.text) : null;
      return <section className="au-provider-card" key={machine.hostId}>
        <div className="au-account">
          {presentation && reading.status === 'ok' ? <>
            {(presentation.account || value.machines.length > 1) && <header className="au-account-heading">
              {presentation.account && <span className="au-account-name">{presentation.account}</span>}
              {value.machines.length > 1 && <span className="au-email">{machine.hostName}</span>}
            </header>}
            {presentation.balances.length > 0 && <dl className="au-amp-balances">
              {presentation.balances.map(balance => <div className="au-amp-balance" key={balance.label}>
                <dt>{balance.label}</dt>
                <dd><strong>{balance.amount}</strong><span>remaining</span></dd>
              </div>)}
            </dl>}
            {presentation.details.length > 0 && <p className="au-native-usage">{presentation.details.join('\n')}</p>}
            <footer className="au-amp-footer">
              <p className="au-reading">{readingAge(reading.observedAt, now)}</p>
              {presentation.settingsUrl && <a href={presentation.settingsUrl} target="_blank" rel="noopener noreferrer">
                Manage credits<Icon name="ArrowUpRight" className="size-3" aria-hidden="true" />
              </a>}
            </footer>
            {machine.message && <p className="au-account-message">Showing previous reading. {machine.message}</p>}
          </> : reading.status === 'unavailable' && <p className="au-account-message">{reading.message}</p>}
        </div>
      </section>;
    })}
  </section>;
}
