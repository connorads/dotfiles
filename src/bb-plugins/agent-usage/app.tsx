import { useCallback, useEffect, useRef, useState } from 'react';
import {
  definePluginApp, experimental_ProviderIcon as ProviderIcon, experimental_useSidebarThreads,
  useRpc, type PluginThreadHeaderActionProps,
} from '@get-bb/plugin-sdk/app';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog.tsx';
import { Icon } from './components/ui/icon.tsx';
import { closeUsage, openUsage, restoreUsageFocus, useUsageOpen } from './overlay-store.ts';
import type { rpcContract, Account, Header, Snapshot, UsageWindow } from './contracts.ts';
import './app.css';

function resetLabel(value: string | null): string {
  if (value === null) return 'Reset time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Reset time unavailable';
  const minutes = Math.ceil((date.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return 'Reset due · refresh usage';
  const duration = minutes < 60 ? `${minutes}m` : minutes < 1440
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  return `Resets in ${duration} · ${date.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function shortWindow(label: string): string {
  return label.replace(/^Weekly limit$|^Seven days$|^Weekly$/u, '7d')
    .replace(/^Five-hour limit$|^Five hours$|^Current session$/u, '5h');
}

function WindowUsage({ window }: { window: UsageWindow }) {
  const tone = window.usedPercent >= 95 ? 'critical' : window.usedPercent >= 80 ? 'warning' : 'normal';
  return <div className="au-window">
    <div className="au-window-heading"><span>{window.label}</span><strong data-tone={tone}>{Math.round(window.usedPercent)}% used</strong></div>
    <div className="au-bar" role="meter" aria-label={window.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, window.usedPercent))}>
      <span data-tone={tone} style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }} />
    </div>
    <div className="au-reset">{resetLabel(window.resetsAt)}</div>
    {window.cost && <div className="au-reset">${(window.cost.usedUsdCents / 100).toFixed(2)} of ${(window.cost.limitUsdCents / 100).toFixed(2)}</div>}
  </div>;
}

function AccountUsage({ account }: { account: Account }) {
  const usage = account.usage;
  const label = account.accountLabel ?? (usage?.status === 'ok' ? usage.accountEmail : null) ?? account.displayName;
  const message = usage === null ? 'Usage unavailable'
    : usage.status === 'unauthenticated' ? account.signInHint
    : usage.status === 'expired' ? account.expiredHint
    : usage.status === 'error' ? usage.message
    : usage.status === 'not_installed' ? 'Not installed'
    : usage.windows.length === 0 ? 'No limits reported for this plan' : null;
  return <section className="au-account" aria-label={`${account.displayName} · ${label}`}>
    <header className="au-account-heading">
      <ProviderIcon providerKind="agent" provider={{ ...account, id: account.providerId }} fallback="Bot" className="size-5" />
      <div className="au-account-name"><h3>{account.displayName}</h3><span>{label}</span></div>
      {usage?.status === 'ok' && usage.planLabel && <span className="au-plan">{usage.planLabel}</span>}
    </header>
    {message ? <p className="au-muted">{message}</p> : usage?.status === 'ok' && usage.windows.map(window => <WindowUsage key={window.label} window={window} />)}
  </section>;
}

export function UsageOverlay() {
  const open = useUsageOpen();
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async (force: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await rpc.call('overview', { refresh: force });
      if (mounted.current) setSnapshot(next);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Usage could not be loaded');
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [rpc]);
  useEffect(() => { if (open) void refresh(false); }, [open, refresh]);
  const machines = snapshot?.machines.filter(machine => machine.providers.some(account => account.usage?.status !== 'not_installed') || machine.error !== null) ?? [];
  return <Dialog open={open} onOpenChange={value => { if (!value) closeUsage(); }}>
    <DialogContent className="au-overlay" onCloseAutoFocus={event => { event.preventDefault(); restoreUsageFocus(); }}>
      <div className="au-overview-heading">
        <div><DialogTitle>Agent usage</DialogTitle><DialogDescription>All providers and accounts. Percentages show allowance used.</DialogDescription></div>
        <button className="au-refresh" type="button" disabled={loading} onClick={() => void refresh(true)}><Icon name="RefreshCw" className="size-4" />{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="au-overview-body" aria-busy={loading}>
        {error && <p role="alert" className="au-error">{snapshot ? 'Showing previous figures. ' : ''}{error}</p>}
        {!snapshot && !error && <p role="status">Loading usage…</p>}
        {snapshot && machines.length === 0 && <p role="status">No usage sources reported. Enable Provider usage in BB’s plugin settings.</p>}
        {machines.map(machine => <section className="au-location" key={machine.id} aria-label={machine.displayName}>
          <h2>{machine.displayName}{machine.status === 'disconnected' && <span className="au-muted"> · Offline</span>}</h2>
          {machine.error && <p className="au-error" role="status">{machine.error}</p>}
          <div className="au-account-grid">{machine.providers.filter(account => account.usage?.status !== 'not_installed').map(account => <AccountUsage key={account.id} account={account} />)}</div>
        </section>)}
      </div>
      <footer className="au-overview-footer"><span>⌘⇧U opens usage</span><span>Esc closes</span></footer>
    </DialogContent>
  </Dialog>;
}

export function ThreadUsage({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const threads = experimental_useSidebarThreads();
  const thread = threads.threads.find(value => value.id === threadId);
  const [header, setHeader] = useState<Header | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = false;
    setHeader(null);
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const next = await rpc.call('header', { threadId });
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
  const label = header?.label ?? thread?.providerId ?? 'Provider';
  const description = header?.windows.map(window => `${window.label}: ${Math.round(window.usedPercent)}% used. ${resetLabel(window.resetsAt)}`).join('\n');
  const title = [label, header?.accountLabel, error ?? header?.message, description].filter(Boolean).join('\n');
  return <button type="button" className="au-thread-usage" aria-label={`Open all agent usage. ${title}`} title={title} aria-haspopup="dialog" onClick={openUsage}>
    <Icon name="ChartColumn" className="size-3.5" />
    {!isCompactViewport && <><span>{label}</span>{error ? <span className="au-muted">Unavailable</span> : header?.windows.length
      ? header.windows.slice(0, 2).map(window => <span key={window.label} data-tone={window.usedPercent >= 95 ? 'critical' : window.usedPercent >= 80 ? 'warning' : 'normal'}>{shortWindow(window.label)} {Math.round(window.usedPercent)}%</span>)
      : <span className="au-muted">{header?.message ?? 'Loading…'}</span>}</>}
  </button>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'usage', title: 'Provider usage', component: ThreadUsage });
  app.slots.experimental_appOverlay({ id: 'overview', component: UsageOverlay });
  app.commands.register({ id: 'open', title: 'Agent usage: show all accounts', defaultShortcut: { key: 'a', mod: true, shift: true }, run: openUsage });
});
