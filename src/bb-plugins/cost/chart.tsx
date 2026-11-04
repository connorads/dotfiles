import { useState } from 'react';
import type { DayCost } from './src/report.ts';
import { providers, type Provider } from './src/records.ts';
import { dayLabel, dayShort, niceTicks, providerName, usd, usdShort } from './src/format.ts';

const plotHeight = 168;

/**
 * Daily cost as columns stacked by provider, Claude Code at the base. One axis in dollars; a hover or focus
 * on a column shows its day and split. The Days table carries every value for readers who cannot use the chart.
 */
export function DailyChart({ days, today }: { days: readonly DayCost[]; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(0, ...days.map(day => day.usd)));
  const top = ticks[ticks.length - 1]!;
  const labelEvery = days.length > 45 ? 14 : days.length > 10 ? 7 : 1;
  const present = providers.filter(provider => days.some(day => (day.byProvider[provider] ?? 0) > 0));
  const shown = active === null ? null : days[active]!;
  return <figure className="cost-chart" aria-label={`Daily cost over ${days.length} days, stacked by provider`}>
    <figcaption className="cost-legend">
      {present.map(provider => <span key={provider} data-provider={provider}>{providerName[provider]}</span>)}
    </figcaption>
    <div className="cost-plot" style={{ height: plotHeight }} onMouseLeave={() => setActive(null)}>
      <ol className="cost-grid" aria-hidden>
        {[...ticks].reverse().map(tick => <li key={tick}><span>{usdShort(tick)}</span></li>)}
      </ol>
      <ol className="cost-columns" data-dense={days.length > 45 || undefined}>
        {days.map((day, index) => {
          const segments = present.map(provider => [provider, day.byProvider[provider] ?? 0] as const).filter(([, value]) => value > 0);
          return <li key={day.day} data-today={day.day === today || undefined} data-active={active === index || undefined}
            tabIndex={0} aria-label={`${dayLabel(day.day)}: ${usd(day.usd)}`}
            onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
            <span className="cost-stack" style={{ height: `${day.usd / top * 100}%` }}>
              {segments.map(([provider, value]) =>
                <i key={provider} data-provider={provider} style={{ flexGrow: value / day.usd }} />)}
            </span>
          </li>;
        })}
      </ol>
      {shown && <Tooltip day={shown} index={active!} total={days.length} present={present} />}
    </div>
    <div className="cost-axis-x" aria-hidden>
      {days.map((day, index) => {
        const last = index === days.length - 1;
        const show = last || (index % labelEvery === 0 && days.length - index > labelEvery / 2);
        return <span key={day.day}>{show ? (day.day === today ? 'Today' : dayShort(day.day)) : ''}</span>;
      })}
    </div>
  </figure>;
}

function Tooltip({ day, index, total, present }: { day: DayCost; index: number; total: number; present: readonly Provider[] }) {
  // The plot's columns start after the 44px axis gutter.
  const fraction = (index + 0.5) / total;
  return <div className="cost-tooltip" role="status" style={{ left: `calc(44px + (100% - 44px) * ${fraction})` }}
    data-edge={fraction > 0.6 ? 'end' : undefined}>
    <strong>{dayLabel(day.day)}</strong>
    <b>{usd(day.usd)}</b>
    {present.filter(provider => (day.byProvider[provider] ?? 0) > 0).map(provider =>
      <span key={provider} data-provider={provider}>{providerName[provider]}<em>{usd(day.byProvider[provider]!)}</em></span>)}
  </div>;
}
