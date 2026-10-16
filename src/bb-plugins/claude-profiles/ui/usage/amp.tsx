import { RollingValue } from './rolling-value.tsx';
import type { AmpOverview } from '../../src/accounts/usage/amp-reading.ts';
import { Icon } from '../components/ui/icon.tsx';
import { presentAmpUsage } from '../../src/accounts/usage/amp-presentation.ts';
import { readingAge, readingState } from '../../src/accounts/usage/format.ts';

export function AmpUsage({ value, message, loading, now }: {
  value: AmpOverview | null; message: string | null; loading: boolean; now: Date;
}) {
  return <section className="au-provider" role="region" aria-label="Amp usage" aria-busy={loading} data-refreshing={loading || undefined}>
    <h3 className="au-provider-heading"><Icon name="Zap" className="size-3.5" />Amp</h3>
    {loading && !value && <p className="au-reading">Checking Amp…</p>}
    {message && <p className="au-account-message">{message}</p>}
    {value?.machines.map(machine => {
      const reading = machine.reading;
      const presentation = reading.status === 'ok' ? presentAmpUsage(reading.text) : null;
      const host = value.machines.length > 1 ? machine.hostName : null;
      return <section className="au-provider-card" key={machine.hostId}>
        <div className="au-account">
          {presentation && reading.status === 'ok' ? <>
            {(presentation.account || host || presentation.settingsUrl) && <header className="au-account-heading">
              {presentation.account && <span className="au-account-name">{presentation.account}</span>}
              {host && <span className="au-plan">{host}</span>}
              {presentation.settingsUrl && <a className="au-amp-link" href={presentation.settingsUrl} target="_blank" rel="noopener noreferrer">
                Manage credits<Icon name="ArrowUpRight" className="size-3" aria-hidden="true" />
              </a>}
            </header>}
            {/* Balances have no limit to measure against, so the amount takes the meter's place. */}
            {presentation.balances.length > 0 && <div role="table" aria-label="Amp balances" className="au-rows">
              {presentation.balances.map(balance => <div className="au-row au-amp-row" role="row" key={balance.label}>
                <span className="au-row-label" role="rowheader">{balance.label}</span>
                <span className="au-amp-amount" role="cell"><RollingValue value={balance.amount} /></span>
                <span className="au-row-detail" role="cell">remaining</span>
              </div>)}
            </div>}
            {presentation.details.length > 0 && <p className="au-native-usage au-amp-details">{presentation.details.join('\n')}</p>}
            {readingState(reading.observedAt, [], now) !== 'fresh' && <p className="au-reading" data-stale
              title={new Date(reading.observedAt).toLocaleString()}>{readingAge(reading.observedAt, now)} · refresh needed</p>}
            {machine.message && <p className="au-account-message">Showing previous reading. {machine.message}</p>}
          </> : reading.status === 'unavailable' && <p className="au-account-message">{reading.message}</p>}
        </div>
      </section>;
    })}
  </section>;
}
