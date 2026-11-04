import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { byLength, byProvider, histogram, stats, type InsightPoint, type Metric } from './src/insights.ts';
import { count, percent, providerName, tokens, usd, usdShort } from './src/format.ts';
import { providers } from './src/records.ts';

const metrics: { id: Metric; label: string; unit: string }[] = [
  { id: 'requests', label: 'Requests', unit: 'model requests' },
  { id: 'turns', label: 'Turns', unit: 'messages that started work' },
  { id: 'peakContext', label: 'Peak context', unit: 'largest prompt, in tokens' },
];

/** Thread-level analysis: how cost spreads across threads, and how it grows with length. */
export function Insights({ days, grouped }: { days: 7 | 30 | 90; grouped: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const [points, setPoints] = useState<InsightPoint[] | null>(null);
  const [metric, setMetric] = useState<Metric>('requests');
  const load = useCallback(() => { rpc.call('insights', { days, group: grouped }).then(value => setPoints(value.points), () => setPoints([])); },
    [rpc, days, grouped]);
  useEffect(load, [load]);
  useRealtime('usage-changed', load);
  const summary = useMemo(() => points && stats(points.map(point => point.usd)), [points]);
  if (!points || !summary) return <p className="cost-blank">Loading…</p>;
  if (!points.length) return <p className="cost-blank">No BB threads used a model in this period.</p>;
  const unit = metrics.find(value => value.id === metric)!;
  return <div className="cost-insights">
    <dl className="cost-tiles cost-tiles-five">
      <div><dt>Median thread</dt><dd>{usd(summary.median)}</dd><dd className="cost-sub">half cost less</dd></div>
      <div><dt>Mean thread</dt><dd>{usd(summary.mean)}</dd><dd className="cost-sub">{(summary.mean / Math.max(summary.median, 0.01)).toFixed(1)}× the median</dd></div>
      <div><dt>90th percentile</dt><dd>{usd(summary.p90)}</dd><dd className="cost-sub">1 in 10 cost more</dd></div>
      <div><dt>Top 10% of threads</dt><dd>{percent(summary.topTenShare)}</dd><dd className="cost-sub">of thread spend</dd></div>
      <div><dt>{grouped ? 'Thread groups' : 'Threads'}</dt><dd>{count(summary.count)}</dd><dd className="cost-sub">most costly {usd(summary.max)}</dd></div>
    </dl>

    <section className="cost-panel">
      <header><h3>How thread costs spread</h3><span className="cost-muted">Threads per cost range</span></header>
      <Histogram points={points} />
    </section>

    <section className="cost-panel">
      <header>
        <h3>Cost against length</h3>
        <div className="cost-segmented" role="radiogroup" aria-label="Length measure">
          {metrics.map(value => <button key={value.id} type="button" role="radio" aria-checked={metric === value.id}
            onClick={() => setMetric(value.id)}>{value.label}</button>)}
        </div>
      </header>
      <p className="cost-note">One dot per {grouped ? 'thread group' : 'thread'}. Length is {unit.unit}. Both axes are logarithmic. Click a dot to open its thread.</p>
      <Scatter points={points} metric={metric} />
      <LengthBands points={points} metric={metric} />
    </section>

    <section className="cost-panel">
      <header><h3>By provider</h3><span className="cost-muted">Cost per {grouped ? 'thread group' : 'thread'}</span></header>
      <table className="cost-table">
        <thead><tr><th>Provider</th><th className="cost-num">Threads</th><th className="cost-num">Median</th><th className="cost-num cost-hide-narrow">Mean</th>
          <th className="cost-num cost-hide-narrow">90th pct</th><th className="cost-num">Total</th></tr></thead>
        <tbody>{byProvider(points).map(row => <tr key={row.provider} className="cost-row-static">
          <td><span className="cost-swatch" data-provider={row.provider}>{providerName[row.provider]}</span></td>
          <td className="cost-num cost-muted">{count(row.count)}</td><td className="cost-num">{usd(row.median)}</td>
          <td className="cost-num cost-hide-narrow">{usd(row.mean)}</td><td className="cost-num cost-hide-narrow">{usd(row.p90)}</td>
          <td className="cost-num">{usd(row.total)}</td>
        </tr>)}</tbody>
      </table>
    </section>
  </div>;
}

function Histogram({ points }: { points: readonly InsightPoint[] }) {
  const bins = histogram(points);
  const max = Math.max(1, ...bins.map(bin => bin.count));
  const total = points.reduce((sum, point) => sum + point.usd, 0);
  return <ol className="cost-histogram">
    {bins.map(bin => <li key={bin.label} title={`${count(bin.count)} threads, ${usd(bin.usd)} together`}>
      <span className="cost-histogram-count">{count(bin.count)}</span>
      <span className="cost-histogram-bar"><i style={{ height: `${bin.count / max * 100}%` }} /></span>
      <span className="cost-histogram-label">{bin.label}</span>
      <span className="cost-histogram-share">{total ? percent(bin.usd / total) : '0%'} of spend</span>
    </li>)}
  </ol>;
}

/** Decade ticks on a log axis, from `lo` up to the first decade at or above `hi`, so every point sits inside. */
export function decades(lo: number, hi: number): number[] {
  const ticks = [10 ** Math.floor(Math.log10(lo))];
  while (ticks[ticks.length - 1]! < hi * 0.9999) ticks.push(ticks[ticks.length - 1]! * 10);
  return ticks.length > 1 ? ticks : [ticks[0]!, ticks[0]! * 10];
}

const scatterHeight = 300;
const pad = { left: 52, right: 12, top: 10, bottom: 26 };

function Scatter({ points, metric }: { points: readonly InsightPoint[]; metric: Metric }) {
  const navigate = useBbNavigate();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<InsightPoint | null>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shown = points.filter(point => point[metric] > 0 && point.usd > 0);
  const xLo = metric === 'peakContext' ? 1000 : 1;
  const xs = shown.map(point => Math.max(xLo, point[metric]));
  const xTicks = decades(xLo, Math.max(xLo * 10, ...xs));
  const yTicks = decades(0.01, Math.max(1, ...shown.map(point => point.usd)));
  const [x0, x1] = [Math.log10(xTicks[0]!), Math.log10(xTicks[xTicks.length - 1]!)];
  const [y0, y1] = [Math.log10(yTicks[0]!), Math.log10(yTicks[yTicks.length - 1]!)];
  const plotW = width - pad.left - pad.right;
  const plotH = scatterHeight - pad.top - pad.bottom;
  const x = (value: number) => pad.left + (Math.log10(Math.max(xLo, value)) - x0) / (x1 - x0) * plotW;
  const y = (value: number) => pad.top + plotH - (Math.log10(Math.max(0.01, value)) - y0) / (y1 - y0) * plotH;
  const xLabel = (value: number) => metric === 'peakContext' ? tokens(value) : count(value);
  // Largest first, so small threads draw on top and stay hoverable.
  const ordered = [...shown].sort((a, b) => b.usd - a.usd);
  return <div className="cost-scatter" ref={frame}>
    <svg width={width} height={scatterHeight} role="img" aria-label={`Cost against ${metric} for ${shown.length} threads`}>
      {yTicks.map(tick => <g key={`y${tick}`} className="cost-tick">
        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
        <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{usdShort(tick)}</text>
      </g>)}
      {xTicks.map(tick => <g key={`x${tick}`} className="cost-tick">
        <line x1={x(tick)} x2={x(tick)} y1={pad.top} y2={pad.top + plotH} />
        <text x={x(tick)} y={scatterHeight - 8} textAnchor="middle">{xLabel(tick)}</text>
      </g>)}
      {ordered.map(point => <circle key={point.threadId} className="cost-dot" data-provider={point.provider} data-active={active === point || undefined}
        cx={x(point[metric])} cy={y(point.usd)} r={active === point ? 6 : 4}
        onMouseEnter={() => setActive(point)} onMouseLeave={() => setActive(null)}
        onClick={() => navigate.toThread(point.threadId)} />)}
    </svg>
    <div className="cost-scatter-legend">
      {providers.filter(provider => shown.some(point => point.provider === provider))
        .map(provider => <span key={provider} data-provider={provider}>{providerName[provider]}</span>)}
    </div>
    {active && <div className="cost-tooltip cost-scatter-tip" role="status"
      style={{ left: x(active[metric]), top: y(active.usd) }} data-edge={x(active[metric]) > width * 0.6 ? 'end' : undefined}>
      <strong>{active.title}</strong>
      <b>{usd(active.usd)}</b>
      <span data-provider={active.provider}>{providerName[active.provider]}<em>{count(active.requests)} requests</em></span>
      <span className="cost-plain">Turns<em>{count(active.turns)}</em></span>
      <span className="cost-plain">Peak context<em>{tokens(active.peakContext)}</em></span>
      {active.subThreads > 0 && <span className="cost-plain">Sub-threads<em>{active.subThreads}</em></span>}
    </div>}
  </div>;
}

function LengthBands({ points, metric }: { points: readonly InsightPoint[]; metric: Metric }) {
  const bands = byLength(points, metric).filter(band => band.count > 0);
  const max = Math.max(0.01, ...bands.map(band => band.median));
  const label = metrics.find(value => value.id === metric)!.label;
  return <table className="cost-table cost-bands">
    <thead><tr><th>{label}</th><th className="cost-num">Threads</th><th>Median cost</th><th className="cost-num">Per request</th></tr></thead>
    <tbody>{bands.map(band => <tr key={band.label} className="cost-row-static">
      <td>{band.label}</td>
      <td className="cost-num cost-muted">{count(band.count)}</td>
      <td><span className="cost-band"><span className="cost-share"><i style={{ width: `${Math.max(1.5, band.median / max * 100)}%` }} /></span>{usd(band.median)}</span></td>
      <td className="cost-num">{usd(band.perRequest)}</td>
    </tr>)}</tbody>
  </table>;
}
