import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders, useBbNavigate, useRealtime, useRpc }
  from '@get-bb/plugin-sdk/app';
import type { PluginNavPanelProps } from '@get-bb/plugin-sdk';
import type { Progress, rpcContract, SeriesView, SummaryView, ThreadView } from './contracts.ts';
import { DailyChart } from './chart.tsx';
import { Insights } from './insights-view.tsx';
import type { Cost, ModelCost, ProjectLine, ThreadLine } from './src/report.ts';
import { ago, count, dateLabel, dayLabel, folder, percent, providerName, shortModel, tokens, usd } from './src/format.ts';
import { periods, setGrouped, setPeriod, useGrouped, usePeriod } from './src/period.ts';
import { providers } from './src/records.ts';

type Tab = 'threads' | 'projects' | 'models' | 'insights' | 'days';
const tabs: { id: Tab; label: string }[] = [
  { id: 'threads', label: 'Threads' }, { id: 'projects', label: 'Projects' }, { id: 'models', label: 'Models' },
  { id: 'insights', label: 'Insights' }, { id: 'days', label: 'Days' }];

/** The page header's controls. The body follows them through the shared store. */
export function PeriodSwitch() {
  const days = usePeriod();
  const grouped = useGrouped();
  return <div className="cost-header-controls">
    <div className="cost-segmented" role="radiogroup" aria-label="Sub-threads"
      title="Grouped counts each sub-thread's usage toward the thread that started it">
      <button type="button" role="radio" aria-checked={!grouped} onClick={() => setGrouped(false)}>Each thread</button>
      <button type="button" role="radio" aria-checked={grouped} onClick={() => setGrouped(true)}>With sub-threads</button>
    </div>
    <div className="cost-segmented" role="radiogroup" aria-label="Period">
      {periods.map(value => <button key={value} type="button" role="radio" aria-checked={days === value}
        onClick={() => setPeriod(value)}>{value} days</button>)}
    </div>
  </div>;
}

export function UsagePage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const days = usePeriod();
  const grouped = useGrouped();
  const [tab, setTab] = useState<Tab>('threads');
  const [data, setData] = useState<SummaryView | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focus = decodeURIComponent(/^thread\/([^/]+)$/.exec(subPath)?.[1] ?? '') || null;
  const load = useCallback(() => {
    rpc.call('summary', { days, group: grouped }).then(value => { setData(value); setError(null); },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    rpc.call('progress', {}).then(setProgress, () => {});
  }, [rpc, days, grouped]);
  useEffect(load, [load]);
  useRealtime('usage-changed', load);

  if (error) return <Shell><p className="cost-blank">Usage could not load: {error}</p></Shell>;
  if (!data) return <Shell><Loading /></Shell>;
  if (!data.firstAt) return <Shell><Empty progress={progress} /></Shell>;
  return <Shell>
    {focus && <FocusedThread threadId={focus} />}
    <Summary data={data} days={days} />
    <section className="cost-card cost-reveal" style={{ '--i': 2 } as React.CSSProperties}>
      <DailyChart days={data.days} today={data.lastDay} />
    </section>
    <section className="cost-card cost-reveal" style={{ '--i': 3 } as React.CSSProperties}>
      <div className="cost-tabs" role="tablist" aria-label="Breakdown">
        {tabs.map(value => <button key={value.id} type="button" role="tab" aria-selected={tab === value.id}
          onClick={() => setTab(value.id)}>{value.label}</button>)}
      </div>
      {tab === 'threads' && <ThreadTable lines={data.threads} data={data} focus={focus} grouped={grouped} />}
      {tab === 'projects' && <ProjectTable lines={data.projects} />}
      {tab === 'models' && <ModelTable models={data.models} />}
      {tab === 'insights' && <Insights days={days} grouped={grouped} />}
      {tab === 'days' && <DayTable data={data} />}
    </section>
    <Footer data={data} progress={progress} />
  </Shell>;
}

const Shell = ({ children }: { children: ReactNode }) =>
  <div className="cost-page"><div className="cost-column">{children}</div></div>;

function Summary({ data, days }: { data: SummaryView; days: number }) {
  const plans = data.plans.reduce((sum, plan) => sum + plan.usd, 0);
  const allTokens = data.total.tokens.input + data.total.tokens.cacheRead + data.total.tokens.cacheWrite + data.total.tokens.output;
  const unpriced = allTokens ? data.total.unpricedTokens / allTokens : 0;
  const dayCount = data.days.length;
  return <section className="cost-summary cost-reveal" style={{ '--i': 1 } as React.CSSProperties}>
    <div className="cost-hero">
      <span className="cost-eyebrow">Last {days} days at API prices</span>
      <strong>{usd(data.total.usd)}</strong>
      <ProviderSplit byProvider={data.byProvider} total={data.total.usd} />
    </div>
    <dl className="cost-tiles">
      <div>
        <dt>This month</dt>
        <dd>{usd(data.monthUsd)}</dd>
        <dd className="cost-sub">{plans > 0
          ? <><b>{(data.monthUsd / plans).toFixed(1)}×</b> your {usd(plans)} of plans</>
          : 'Add plan prices in settings to compare'}</dd>
      </div>
      <div>
        <dt>Daily average</dt>
        <dd>{usd(data.total.usd / dayCount)}</dd>
        <dd className="cost-sub">over {dayCount} days</dd>
      </div>
      <div>
        <dt>Requests</dt>
        <dd>{count(data.total.requests)}</dd>
        <dd className="cost-sub">{tokens(allTokens)} tokens</dd>
      </div>
      <div title={data.models.filter(model => !model.priced).map(model => model.model).join(', ') || undefined}>
        <dt>Unpriced</dt>
        <dd>{percent(unpriced)}</dd>
        <dd className="cost-sub">of tokens have no list price</dd>
      </div>
    </dl>
  </section>;
}

function ProviderSplit({ byProvider, total }: { byProvider: SummaryView['byProvider']; total: number }) {
  const present = providers.filter(provider => (byProvider[provider] ?? 0) > 0);
  if (!total || present.length < 2) return null;
  return <div className="cost-split">
    <span className="cost-split-bar" aria-hidden>
      {present.map(provider => <i key={provider} data-provider={provider} style={{ flexGrow: byProvider[provider]! / total }} />)}
    </span>
    <span className="cost-split-legend">
      {present.map(provider => <span key={provider} data-provider={provider}>
        {providerName[provider]} <b>{percent(byProvider[provider]! / total)}</b>
      </span>)}
    </span>
  </div>;
}

function useProviderRecord() {
  const { providers: known } = useProviders();
  return (id: string) => known.find(provider => provider.id === id) ?? { id };
}

function ThreadTable({ lines, data, focus, grouped }: { lines: readonly ThreadLine[]; data: SummaryView; focus: string | null; grouped: boolean }) {
  const navigate = useBbNavigate();
  const provider = useProviderRecord();
  const [all, setAll] = useState(false);
  const max = Math.max(0.01, ...lines.map(line => line.usd));
  const visible = all ? lines : lines.slice(0, 25);
  if (!lines.length) return <p className="cost-blank">No usage in this period.</p>;
  return <>
    <table className="cost-table">
      <thead><tr><th>Thread</th><th className="cost-hide-narrow">Last active</th><th className="cost-hide-narrow">Share</th><th className="cost-num">Cost</th></tr></thead>
      <tbody>
        {visible.map((line, index) => {
          const info = line.threadId ? data.threadInfo[line.threadId] : undefined;
          const outside = !line.threadId;
          return <tr key={line.threadId ?? `cwd:${line.cwd}`} data-focus={(focus !== null && line.threadId === focus) || undefined}
            className="cost-row" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
            onClick={line.threadId ? () => navigate.toThread(line.threadId!) : undefined}>
            <td>
              <span className="cost-entity">
                <span className="cost-glyph">{outside ? <FolderGlyph /> :
                  <ProviderIcon providerKind="agent" provider={provider(info?.provider ?? line.providers[0] ?? 'claude-code')} aria-hidden />}</span>
                <span className="cost-entity-text">
                  {line.threadId
                    ? <button type="button" className="cost-title" onClick={event => { event.stopPropagation(); navigate.toThread(line.threadId!); }}>
                        {info?.title ?? 'Untitled thread'}</button>
                    : <span className="cost-title" title={line.cwd ?? undefined}>{line.cwd ? folder(line.cwd) : 'Unknown directory'}</span>}
                  <span className="cost-meta">{outside
                    ? <><span className="cost-tag">Outside BB</span>{line.providers.map(value => providerName[value]).join(', ')}</>
                    : [info?.projectName, line.providers.map(value => providerName[value]).join(', ')].filter(Boolean).join(' · ')}</span>
                </span>
              </span>
            </td>
            <td className="cost-muted cost-hide-narrow">{ago(line.lastAt)}</td>
            <td className="cost-hide-narrow"><Share value={line.usd / max} /></td>
            <td className="cost-num"><Amount cost={line} /></td>
          </tr>;
        })}
      </tbody>
    </table>
    {lines.length > 25 && <button type="button" className="cost-more" onClick={() => setAll(!all)}>
      {all ? 'Show top 25' : lines.length < data.threadCount ? `Show top ${lines.length}` : `Show all ${lines.length}`}</button>}
    {all && lines.length < data.threadCount && <p className="cost-note cost-centre">
      {count(data.threadCount - lines.length)} more {grouped ? 'thread groups' : 'threads'} each cost {usd(lines[lines.length - 1]!.usd)} or less.</p>}
  </>;
}

function ProjectTable({ lines }: { lines: readonly ProjectLine[] }) {
  const navigate = useBbNavigate();
  const max = Math.max(0.01, ...lines.map(line => line.usd));
  if (!lines.length) return <p className="cost-blank">No usage in this period.</p>;
  return <table className="cost-table">
    <thead><tr><th>Project</th><th className="cost-hide-narrow">Last active</th><th className="cost-hide-narrow">Share</th><th className="cost-num">Cost</th></tr></thead>
    <tbody>
      {lines.map((line, index) => {
        const threads = line.threads ? `${line.threads} thread${line.threads === 1 ? '' : 's'}` : null;
        const outside = line.outsideUsd > 0 ? `${usd(line.outsideUsd)} outside BB` : null;
        return <tr key={line.key} className="cost-row" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
          onClick={line.projectId ? () => navigate.toProject(line.projectId!) : undefined}>
          <td>
            <span className="cost-entity">
              <span className="cost-glyph">{line.projectId ? <span className="cost-initial">{line.name.slice(0, 1).toUpperCase()}</span> : <FolderGlyph />}</span>
              <span className="cost-entity-text">
                {line.projectId
                  ? <button type="button" className="cost-title" onClick={event => { event.stopPropagation(); navigate.toProject(line.projectId!); }}>{line.name}</button>
                  : <span className="cost-title">{line.name}</span>}
                <span className="cost-meta">{!line.projectId && line.name !== 'No project' && <span className="cost-tag">Not a BB project</span>}
                  {[threads, outside, line.providers.map(value => providerName[value]).join(', ')].filter(Boolean).join(' · ')}</span>
              </span>
            </span>
          </td>
          <td className="cost-muted cost-hide-narrow">{ago(line.lastAt)}</td>
          <td className="cost-hide-narrow"><Share value={line.usd / max} /></td>
          <td className="cost-num"><Amount cost={line} /></td>
        </tr>;
      })}
    </tbody>
  </table>;
}

function ModelTable({ models }: { models: readonly ModelCost[] }) {
  return <>
    <div className="cost-mix-legend" aria-hidden>
      <span data-part="cacheRead">Cache read</span><span data-part="cacheWrite">Cache write</span>
      <span data-part="input">Input</span><span data-part="output">Output</span>
    </div>
    <table className="cost-table">
      <thead><tr><th>Model</th><th className="cost-hide-narrow">Where the dollars go</th><th className="cost-num cost-hide-narrow">Requests</th><th className="cost-num">Cost</th></tr></thead>
      <tbody>
        {models.map((model, index) => <tr key={`${model.provider}:${model.model}`} className="cost-row" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
          <td>
            <span className="cost-entity-text">
              <span className="cost-title cost-mono" title={model.model}>{shortModel(model.model)}</span>
              <span className="cost-meta">{providerName[model.provider]} · {tokens(model.tokens.input + model.tokens.cacheRead + model.tokens.cacheWrite + model.tokens.output)} tokens</span>
            </span>
          </td>
          <td className="cost-hide-narrow">{model.priced ? <Mix cost={model} /> : <span className="cost-muted">Not in the price file</span>}</td>
          <td className="cost-num cost-muted cost-hide-narrow">{count(model.requests)}</td>
          <td className="cost-num">{model.priced ? usd(model.usd) : <span className="cost-muted">—</span>}</td>
        </tr>)}
      </tbody>
    </table>
  </>;
}

function DayTable({ data }: { data: SummaryView }) {
  const present = providers.filter(provider => (data.byProvider[provider] ?? 0) > 0);
  return <table className="cost-table">
    <thead><tr><th>Day</th>{present.map(provider => <th key={provider} className="cost-num cost-hide-narrow">{providerName[provider]}</th>)}<th className="cost-num">Total</th></tr></thead>
    <tbody>
      {[...data.days].reverse().map(day => <tr key={day.day} className="cost-row-static">
        <td>{day.day === data.lastDay ? 'Today' : dayLabel(day.day)}</td>
        {present.map(provider => <td key={provider} className="cost-num cost-muted cost-hide-narrow">{day.byProvider[provider] ? usd(day.byProvider[provider]!) : '—'}</td>)}
        <td className="cost-num">{day.usd ? usd(day.usd) : <span className="cost-muted">—</span>}</td>
      </tr>)}
    </tbody>
  </table>;
}

/** The thread the header chip opened: its total, where the dollars went and which models it used. */
function FocusedThread({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [view, setView] = useState<ThreadView | null | undefined>(undefined);
  const load = useCallback(() => { rpc.call('thread', { threadId }).then(setView, () => setView(null)); }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime('usage-changed', load);
  if (view === undefined) return null;
  return <section className="cost-card cost-focus cost-reveal" style={{ '--i': 0 } as React.CSSProperties}>
    <header>
      <span className="cost-eyebrow">This thread, all time</span>
      <button type="button" className="cost-close" aria-label="Show all usage" onClick={() => navigate.toPluginPanel('usage', { subPath: '' })}>×</button>
    </header>
    {view ? <>
      <div className="cost-focus-head">
        <button type="button" className="cost-title" onClick={() => navigate.toThread(threadId)}>{view.title ?? 'Untitled thread'}</button>
        <strong>{usd(view.usd)}</strong>
      </div>
      <Mix cost={view} labelled />
      <Growth threadId={threadId} />
      <ul className="cost-focus-models">
        {view.models.map(model => <li key={`${model.provider}:${model.model}`}>
          <span className="cost-mono">{shortModel(model.model)}</span>
          <span className="cost-muted">{count(model.requests)} requests</span>
          <b>{model.priced ? usd(model.usd) : 'no price'}</b>
        </li>)}
      </ul>
    </> : <p className="cost-blank">No usage recorded for this thread yet.</p>}
  </section>;
}

const growthHeight = 96;

/** Each request's cost over the thread's life: context grows, so later requests usually cost more. */
function Growth({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [series, setSeries] = useState<SeriesView | null>(null);
  const load = useCallback(() => { rpc.call('series', { threadId }).then(setSeries, () => setSeries(null)); }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime('usage-changed', load);
  if (!series || series.points.length < 2) return null;
  const max = Math.max(...series.points.map(point => point.usd), 0.0001);
  const last = series.points[series.points.length - 1]!.index;
  // A viewBox in data units with a non-scaling stroke keeps the line 2px at any width; labels stay in HTML.
  const path = series.points.map((point, index) =>
    `${index ? 'L' : 'M'}${(point.index - 1) / Math.max(1, last - 1) * 1000},${growthHeight - point.usd / max * (growthHeight - 4)}`).join(' ');
  return <figure className="cost-growth">
    <figcaption>
      <span>Cost per request across {count(series.requests)} requests</span>
      {series.growth !== null && <b>{series.growth >= 1.15 ? `The last tenth cost ${series.growth.toFixed(1)}× the first`
        : series.growth <= 0.87 ? `The last tenth cost ${percent(series.growth)} of the first` : 'Steady cost per request'}</b>}
    </figcaption>
    <div className="cost-growth-plot">
      <span className="cost-growth-max">{usd(max)}</span>
      <svg viewBox={`0 0 1000 ${growthHeight}`} preserveAspectRatio="none" height={growthHeight} width="100%" aria-hidden>
        <path d={`${path} L1000,${growthHeight} L0,${growthHeight} Z`} className="cost-growth-area" />
        <path d={path} className="cost-growth-line" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
    <div className="cost-growth-axis"><span>Request 1</span><span>Request {count(last)}</span></div>
  </figure>;
}

const parts = ['cacheRead', 'cacheWrite', 'input', 'output'] as const;
const partName = { cacheRead: 'Cache read', cacheWrite: 'Cache write', input: 'Input', output: 'Output' };

/** A cost's split by token type, as one bar; `labelled` adds the amounts beneath. */
function Mix({ cost, labelled = false }: { cost: Cost; labelled?: boolean }) {
  const total = parts.reduce((sum, part) => sum + cost.parts[part], 0);
  if (!total) return null;
  const title = parts.map(part => `${partName[part]} ${usd(cost.parts[part])}`).join(' · ');
  return <div className="cost-mix" title={title}>
    <span className="cost-mix-bar" aria-label={title} role="img">
      {parts.filter(part => cost.parts[part] > 0).map(part => <i key={part} data-part={part} style={{ flexGrow: cost.parts[part] / total }} />)}
    </span>
    {labelled && <span className="cost-mix-labels">
      {parts.map(part => <span key={part} data-part={part}>{partName[part]} <b>{usd(cost.parts[part])}</b></span>)}
    </span>}
  </div>;
}

const Share = ({ value }: { value: number }) =>
  <span className="cost-share" aria-hidden><i style={{ width: `${Math.max(1.5, value * 100)}%` }} /></span>;

function Amount({ cost }: { cost: Cost }) {
  if (cost.usd === 0 && cost.unpricedTokens > 0) return <span className="cost-muted" title="These models have no list price">no price</span>;
  return <>{usd(cost.usd)}</>;
}

function Footer({ data, progress }: { data: SummaryView; progress: Progress | null }) {
  return <footer className="cost-footer cost-reveal" style={{ '--i': 4 } as React.CSSProperties}>
    <span>Estimates at LiteLLM list prices{data.pricesAt ? `, updated ${ago(data.pricesAt)}` : ''}. Subscriptions do not bill these amounts.</span>
    <span>{progress?.state === 'running'
      ? `Backfill ${progress.bytes ? percent(progress.bytesDone / progress.bytes) : '0%'} · ${count(progress.records)} requests read`
      : data.firstAt ? `History since ${dateLabel(data.firstAt)}` : ''}</span>
  </footer>;
}

function Empty({ progress }: { progress: Progress | null }) {
  return <div className="cost-empty">
    <strong>No usage recorded yet</strong>
    {progress?.state === 'running'
      ? <p>Reading session logs: {progress.bytes ? percent(progress.bytesDone / progress.bytes) : '0%'} done.</p>
      : <p>New turns appear here as threads finish. To read past sessions, run <code>bb cost backfill</code>.</p>}
  </div>;
}

const Loading = () => <div className="cost-loading" aria-busy aria-label="Loading usage">
  <span style={{ height: 84 }} /><span style={{ height: 220 }} /><span style={{ height: 320 }} />
</div>;

const FolderGlyph = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden>
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
</svg>;
