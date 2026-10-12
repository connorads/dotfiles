import { useEffect, useState } from 'react';
import { experimental_useSidebarThreads, useRpc, type PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk/app';
import { Icon } from '../components/ui/icon.tsx';
import type { rpcContract } from '../../contracts.ts';
import type { Header, UsageWindow } from '../../src/accounts/usage/contract.ts';
import { bindingWindow, clock, percent, SHORT, viewWindow, type WindowView } from '../../src/accounts/usage/format.ts';
import { openUsage } from './overlay-store.ts';
import { useNow } from './use-now.ts';
import './usage.css';

function Ring({ window, view }: { window: UsageWindow; view: WindowView }) {
  const radius = 5.25;
  const circumference = 2 * Math.PI * radius;
  const fill = view.pace.kind === 'elapsed' ? 0 : Math.min(100, Math.max(0, window.usedPercent));
  return <svg className="au-ring" data-tone={view.tone} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
    <circle className="au-ring-track" cx="7" cy="7" r={radius} />
    <circle className="au-ring-fill" cx="7" cy="7" r={radius} strokeDasharray={`${circumference * fill / 100} ${circumference}`} />
  </svg>;
}

function headerTitle(header: Header | null, error: string | null, now: Date): string {
  if (error) return `${error}\nClick to see all accounts.`;
  if (!header) return 'Loading usage…';
  const lines = header.windows.map(window => {
    const view = viewWindow(window, now);
    return [`${window.label}: ${view.pace.kind === 'elapsed' ? 'reset since last check' : `${percent(window.usedPercent)} used`}`,
      view.pace.kind === 'elapsed' ? '' : view.status, view.reset ?? ''].filter(Boolean).join(' · ');
  });
  return [[header.label, header.accountLabel].filter(Boolean).join(' · '), header.message, ...lines, 'Click to see all accounts.']
    .filter(Boolean).join('\n');
}

export function ThreadUsage({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const threads = experimental_useSidebarThreads();
  const thread = threads.threads.find(value => value.id === threadId);
  const [header, setHeader] = useState<Header | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(60_000);
  useEffect(() => {
    let alive = true;
    let pending = false;
    setHeader(null);
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const next = await rpc.call('usage.header', { threadId });
        if (alive) { setHeader(next); setError(null); }
      } catch {
        if (alive) setError('Usage unavailable');
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 120_000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [rpc, threadId, thread?.providerId, thread?.status]);
  const binding = header ? bindingWindow(header.windows, now) : null;
  const title = headerTitle(header, error, now);
  const short = binding?.window.period ? SHORT[binding.window.period] : binding?.window.label;
  const text = !binding ? null
    : binding.view.pace.kind === 'limited' ? `${short} limit · back ${clock(binding.view.pace.resetsAt, now)}`
    : binding.view.pace.kind === 'paced' && binding.view.pace.runsOutAt ? `${short} ${percent(binding.window.usedPercent)} · out ${clock(binding.view.pace.runsOutAt, now)}`
    : `${short} ${percent(binding.window.usedPercent)}`;
  return <button type="button" className="au-badge" data-au-thread={threadId} data-tone={binding?.view.tone ?? 'normal'} aria-label={`Open all agent usage. ${title}`}
    title={title} aria-haspopup="dialog" onClick={openUsage}>
    {binding ? <Ring window={binding.window} view={binding.view} /> : <Icon name="ChartColumn" className="size-3.5" />}
    {!isCompactViewport && (text ? <span className="au-badge-text">{text}</span>
      : error || header ? <span className="au-badge-muted">Usage</span> : null)}
  </button>;
}
