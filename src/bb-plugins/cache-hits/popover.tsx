import type { ReactNode } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import type { DotTone } from '@bb-plugins/chip';
import { expiresAt, hitRatio, type CacheState, type HistoryEntry } from './src/cache.ts';
import { clock, gap, lifetime, missReason, percent, timeOfDay, tokens, writeMultiplier } from './src/format.ts';

export type Warmth = {
  /** Share of the lifetime left, or null when the provider reports none (Codex, Pi). */
  left: number | null;
  /** Last request hit rate. */
  ratio: number;
  level: DotTone;
};

export function warmth(state: CacheState, now: number): Warmth | null {
  const ratio = state.last ? hitRatio(state.last.read, state.last.prompt) : null;
  if (ratio === null) return null;
  const expiry = expiresAt(state);
  // The dot shows cache warmth when the provider reports a lifetime, otherwise the last hit rate.
  const left = expiry === null || state.ttlMs === null ? null : Math.max(0, (expiry - now) / state.ttlMs);
  const [fraction, ok, warn] = left === null ? [ratio, 0.8, 0.5] : [left, 0.5, 0.2];
  return { left, ratio, level: fraction > ok ? 'ok' : fraction > warn ? 'warn' : 'danger' };
}

function Status({ state, now, view }: { state: CacheState; now: number; view: Warmth }) {
  const expiry = expiresAt(state);
  const rebuild = state.last?.prompt ?? 0;
  if (view.left === null || expiry === null || state.ttlMs === null) return <header className="ch-status" data-level={view.level}>
    <div className="ch-headline"><strong>{percent(view.ratio)}</strong><span>of the last request came from cache</span></div>
    <p className="ch-note">This provider reports no cache lifetime, so there is no countdown.</p>
  </header>;
  const ttl = lifetime(state.ttlMs);
  if (view.left <= 0) return <header className="ch-status" data-level="danger">
    <div className="ch-headline"><strong>Cold</strong>
      <span>{expiry === state.invalidatedAt ? 'Claude account switched' : `expired ${gap(now - expiry)} ago`}</span></div>
    <Meter fraction={0} label="Cache lifetime left" />
    <p className="ch-note">The next request rewrites <b>{tokens(rebuild)}</b> tokens at {writeMultiplier(state.ttlMs)}× the input price.</p>
  </header>;
  return <header className="ch-status" data-level={view.level}>
    <div className="ch-headline"><strong>{clock(expiry - now)}</strong><span>left of {ttl} · cold at {timeOfDay(expiry)}</span></div>
    <Meter fraction={view.left} label="Cache lifetime left" />
    <p className="ch-note">Each request resets the {ttl} clock. Going cold rewrites <b>{tokens(rebuild)}</b> at {writeMultiplier(state.ttlMs)}× the input price.</p>
  </header>;
}

function Meter({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(fraction * 100);
  return <span className="ch-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
    <i style={{ width: `${pct}%` }} />
  </span>;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="ch-stat"><dt>{label}</dt><dd>{value}</dd>{sub && <dd className="ch-sub">{sub}</dd>}</div>;
}

function Stats({ state }: { state: CacheState }) {
  const thread = hitRatio(state.read, state.prompt);
  const last = state.last;
  return <dl className="ch-stats">
    <Stat label="Thread" value={thread === null ? '–' : percent(thread)} sub={`${tokens(state.read)} of ${tokens(state.prompt)} cached`} />
    <Stat label="Last request" value={last ? percent(hitRatio(last.read, last.prompt) ?? 0) : '–'}
      sub={last && `read ${tokens(last.read)} · wrote ${tokens(last.write)}`} />
    <Stat label="Misses" value={state.misses} sub={state.misses ? `${tokens(state.missedTokens)} re-sent` : 'none yet'} />
  </dl>;
}

function describeEntry(entry: HistoryEntry) {
  const parts = [`${timeOfDay(entry.at)} · ${tokens(entry.prompt)} prompt`, `read ${tokens(entry.read)}`, `wrote ${tokens(entry.write)}`];
  if (entry.miss) parts.push(`miss: ${tokens(entry.miss.tokens)} re-sent, ${missReason(entry.miss)}`);
  if (entry.afterReset) parts.push('after compaction');
  return parts.join('\n');
}

/** One column per request: cached reads at the base, fresh writes above, red when the write re-sent a lost cache. */
function Chart({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) return <p className="ch-empty">The chart fills in as this thread sends requests.</p>;
  const max = Math.max(...history.map(entry => entry.prompt));
  const first = history[0]!;
  const last = history.at(-1)!;
  return <figure className="ch-chart">
    <figcaption>
      <span>Last {history.length} request{history.length === 1 ? '' : 's'}</span>
      <span className="ch-legend">
        <span data-part="read">cached</span><span data-part="write">written</span><span data-part="miss">re-sent</span>
      </span>
    </figcaption>
    <div className="ch-plot">
      <span className="ch-axis-y" aria-hidden="true">{tokens(max)}</span>
      <ol className="ch-bars" aria-label="Prompt tokens per request">
        {history.map((entry, index) => {
          const height = (value: number) => `${(value / max) * 100}%`;
          const rest = Math.max(0, entry.prompt - entry.read - entry.write);
          return <li key={`${entry.at}-${index}`} title={describeEntry(entry)} aria-label={describeEntry(entry)}
            data-miss={entry.miss ? entry.miss.cause : undefined} data-reset={entry.afterReset || undefined}>
            <i data-part="rest" style={{ height: height(rest) }} />
            <i data-part={entry.miss ? 'miss' : 'write'} style={{ height: height(entry.write) }} />
            <i data-part="read" style={{ height: height(entry.read) }} />
          </li>;
        })}
      </ol>
    </div>
    <div className="ch-axis-x" aria-hidden="true"><span>{timeOfDay(first.at)}</span><span>{timeOfDay(last.at)}</span></div>
  </figure>;
}

function Misses({ history }: { history: HistoryEntry[] }) {
  const misses = history.filter(entry => entry.miss).reverse().slice(0, 4);
  if (misses.length === 0) return null;
  return <section className="ch-misses" aria-label="Recent misses">
    <h3>Recent misses</h3>
    <ul>{misses.map((entry, index) => <li key={`${entry.at}-${index}`}>
      <span className="ch-time">{timeOfDay(entry.at)}</span>
      <b>{tokens(entry.miss!.tokens)}</b>
      <span>{missReason(entry.miss!)}</span>
    </li>)}</ul>
  </section>;
}

export function CachePopover({ state, now, view, trigger, onClose }: {
  state: CacheState; now: number; view: Warmth; trigger: () => HTMLElement | null; onClose: () => void;
}) {
  return <ChipPopover aria-label="Prompt cache" panelClassName="ch-panel" trigger={trigger} anchor={null} width={380} onClose={onClose}>
    <Status state={state} now={now} view={view} />
    <Stats state={state} />
    <Chart history={state.history} />
    <Misses history={state.history} />
  </ChipPopover>;
}
