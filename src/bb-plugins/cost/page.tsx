import { useCallback, useEffect, useState } from 'react';
import { useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginNavPanelProps } from '@get-bb/plugin-sdk';
import type { Progress, rpcContract, SummaryView } from './contracts.ts';
import { ago, shortModel, tokens, usd } from './src/format.ts';

type Days = 7 | 30 | 90;
type View = 'threads' | 'models' | 'days';

export function UsagePage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [days, setDays] = useState<Days>(30);
  const [view, setView] = useState<View>('threads');
  const [data, setData] = useState<SummaryView | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focus = decodeURIComponent(/^thread\/(.+)$/.exec(subPath)?.[1] ?? '') || null;
  const load = useCallback(() => {
    rpc.call('summary', { days }).then(value => { setData(value); setError(null); }, (reason: unknown) => setError(String(reason)));
    rpc.call('progress', {}).then(setProgress, () => {});
  }, [rpc, days]);
  useEffect(load, [load]);
  useRealtime('usage-changed', load);

  if (error) return <div className="cost-page"><p className="cost-muted">{error}</p></div>;
  if (!data) return <div className="cost-page"><p className="cost-muted">Loading…</p></div>;
  const max = Math.max(...data.days.map(d => d.usd), 0.01);
  const plans = data.plans.reduce((sum, plan) => sum + plan.usd, 0);
  return <div className="cost-page">
    <div className="cost-toolbar">
      {([7, 30, 90] as const).map(value => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value}d</button>)}
    </div>
    <section className="cost-headline">
      <div><strong>{usd(data.total.usd)}</strong> <span className="cost-muted">API est. · last {days} days</span></div>
      <div className="cost-muted">This month {usd(data.monthUsd)}{plans > 0 && ` · plans ${usd(plans)} · ${(data.monthUsd / plans).toFixed(1)}× value`}</div>
    </section>
    <ol className="cost-bars">
      {data.days.map(d => <li key={d.day} title={`${d.day}: ${usd(d.usd)}`} style={{ height: `${d.usd / max * 100}%` }} />)}
    </ol>
    <div className="cost-toolbar">
      {(['threads', 'models', 'days'] as const).map(value => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value}</button>)}
    </div>
    {view === 'threads' && <table className="cost-table"><tbody>
      {data.threads.map(line => <tr key={line.threadId ?? 'outside'} data-focus={line.threadId === focus || undefined}>
        <td>{line.threadId
          ? <button className="cost-link" onClick={() => navigate.toThread(line.threadId!)}>{data.threadInfo[line.threadId]?.title ?? line.threadId}</button>
          : <span className="cost-muted">Outside BB</span>}</td>
        <td className="cost-muted">{line.providers.join(', ')}</td>
        <td className="cost-muted">{ago(line.lastAt)}</td>
        <td className="cost-num">{usd(line.usd)}</td>
      </tr>)}
    </tbody></table>}
    {view === 'models' && <table className="cost-table"><tbody>
      {data.models.map(model => <tr key={`${model.provider}:${model.model}`}>
        <td>{shortModel(model.model)}</td><td className="cost-muted">{model.provider}</td>
        <td className="cost-muted">{tokens(model.tokens.input + model.tokens.cacheRead + model.tokens.cacheWrite + model.tokens.output)}</td>
        <td className="cost-num">{model.priced ? usd(model.usd) : 'no price'}</td>
      </tr>)}
    </tbody></table>}
    {view === 'days' && <table className="cost-table"><tbody>
      {[...data.days].reverse().map(d => <tr key={d.day}><td>{d.day}</td><td className="cost-num">{usd(d.usd)}</td></tr>)}
    </tbody></table>}
    <p className="cost-muted">
      Prices {data.pricesAt ? `from LiteLLM, ${ago(data.pricesAt)}` : 'not fetched'}
      {progress?.state === 'running' && ` · backfill ${progress.bytes ? Math.round(progress.bytesDone / progress.bytes * 100) : 0}%`}
    </p>
  </div>;
}
