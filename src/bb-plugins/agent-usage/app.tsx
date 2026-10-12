import { useCallback, useEffect, useRef, useState } from 'react';
import {
  definePluginApp, experimental_ProviderIcon as ProviderIcon, experimental_useSidebarThreads,
  useRpc, type PluginThreadHeaderActionProps,
} from '@get-bb/plugin-sdk/app';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog.tsx';
import { Icon } from './components/ui/icon.tsx';
import { closeUsage, openUsage, restoreUsageFocus, useUsageOpen } from './overlay-store.ts';
import { bindingWindow, clock, duration, percent, SHORT, viewWindow, type WindowView } from './format.ts';
import type { rpcContract, Account, Header, Snapshot, UsageWindow } from './contracts.ts';
import './app.css';

/** Re-renders on an interval so countdowns and "updated" times stay true while visible. */
function useNow(intervalMs: number, active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

function Meter({ window, view }: { window: UsageWindow; view: WindowView }) {
  const elapsed = view.pace.kind === 'elapsed';
  const fill = elapsed ? 0 : Math.min(100, Math.max(0, window.usedPercent));
  const marker = view.pace.kind === 'paced' || view.pace.kind === 'early' ? view.pace.expectedPercent : null;
  return <span className="au-meter" data-tone={view.tone} data-elapsed={elapsed || undefined} aria-hidden="true">
    <span className="au-meter-fill" style={{ width: `${fill}%` }} />
    {marker !== null && <span className="au-meter-pace" style={{ left: `${marker}%` }} />}
  </span>;
}

function Ring({ window, view }: { window: UsageWindow; view: WindowView }) {
  const radius = 5.25;
  const circumference = 2 * Math.PI * radius;
  const fill = view.pace.kind === 'elapsed' ? 0 : Math.min(100, Math.max(0, window.usedPercent));
  return <svg className="au-ring" data-tone={view.tone} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
    <circle className="au-ring-track" cx="7" cy="7" r={radius} />
    <circle className="au-ring-fill" cx="7" cy="7" r={radius} strokeDasharray={`${circumference * fill / 100} ${circumference}`} />
  </svg>;
}

function WindowRow({ window, now }: { window: UsageWindow; now: Date }) {
  const view = viewWindow(window, now);
  const expected = view.pace.kind === 'paced' || view.pace.kind === 'early' ? ` Even pace would be ${percent(view.pace.expectedPercent)}.` : '';
  return <div className="au-row" role="row" aria-label={`${window.label}: ${percent(window.usedPercent)} used. ${view.status}.${expected}`}>
    <span className="au-row-label" role="rowheader">{window.label}</span>
    <span className="au-row-meter" role="cell"><Meter window={window} view={view} /></span>
    <span className="au-row-value" role="cell" data-tone={view.tone}>{view.pace.kind === 'elapsed' ? '–' : percent(window.usedPercent)}</span>
    <span className="au-row-status" role="cell" data-tone={view.tone} data-quiet={view.tone === 'normal' && !view.credit || undefined}>{view.status}</span>
    <span className="au-row-reset" role="cell">{view.reset ?? ''}</span>
  </div>;
}

function accountName(account: Account): string {
  return account.accountLabel ?? (account.usage?.status === 'ok' ? account.usage.accountEmail : null) ?? account.displayName;
}

function AccountBlock({ account, now }: { account: Account; now: Date }) {
  const usage = account.usage;
  const name = accountName(account);
  const email = usage?.status === 'ok' && usage.accountEmail !== name ? usage.accountEmail : null;
  const message = usage === null ? 'Usage not reported'
    : usage.status === 'unauthenticated' ? account.signInHint
    : usage.status === 'expired' ? account.expiredHint
    : usage.status === 'error' ? usage.message
    : usage.status === 'ok' && usage.windows.length === 0 ? 'No limits on this plan' : null;
  return <section className="au-account" aria-label={`${account.displayName} · ${name}`}>
    <header className="au-account-heading">
      <span className="au-account-name">{name}</span>
      {usage?.status === 'ok' && usage.planLabel && <span className="au-plan">{usage.planLabel}</span>}
      {email && <span className="au-email">{email}</span>}
    </header>
    {message ? <p className="au-account-message">{message}</p>
      : usage?.status === 'ok' && <div role="table" aria-label={`${name} limits`} className="au-rows">
        {usage.windows.map(window => <WindowRow key={window.label} window={window} now={now} />)}
      </div>}
  </section>;
}

function ProviderGroup({ accounts, now }: { accounts: Account[]; now: Date }) {
  const [first] = accounts;
  if (!first) return null;
  return <section className="au-provider" aria-label={first.displayName}>
    <h3 className="au-provider-heading">
      <ProviderIcon providerKind="agent" provider={{ ...first, id: first.providerId }} fallback="Bot" className="size-4" />
      {first.displayName}
    </h3>
    <div className="au-provider-card">{accounts.map(account => <AccountBlock key={account.id} account={account} now={now} />)}</div>
  </section>;
}

function byProvider(accounts: Account[]): Account[][] {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) groups.set(account.providerId, [...groups.get(account.providerId) ?? [], account]);
  return [...groups.values()];
}

const RANK = { normal: 0, warning: 1, critical: 2 } as const;

/** One sentence that answers "can I keep going, and where should I go if not". */
function Summary({ accounts, now }: { accounts: Account[]; now: Date }) {
  const bound = accounts.flatMap(account => {
    const binding = account.usage?.status === 'ok' ? bindingWindow(account.usage.windows, now) : null;
    return binding ? [{ account, ...binding }] : [];
  });
  if (bound.length === 0) return null;
  const worst = [...bound].sort((a, b) => RANK[b.view.tone] - RANK[a.view.tone] || b.window.usedPercent - a.window.usedPercent)[0]!;
  if (worst.view.tone === 'normal') {
    return <p className="au-summary" data-tone="normal"><Icon name="CircleCheck" className="size-4" />Every account is within its limits.</p>;
  }
  const subject = `${accountName(worst.account)} · ${worst.window.label}`;
  const { pace } = worst.view;
  const detail = pace.kind === 'limited' ? `limit reached. Back ${clock(pace.resetsAt, now)}.`
    : pace.kind === 'paced' && pace.runsOutAt && worst.window.resetsAt
      ? `runs out ${clock(pace.runsOutAt, now)}, ${duration(new Date(worst.window.resetsAt).getTime() - pace.runsOutAt.getTime())} before it resets.`
      : `${percent(worst.window.usedPercent)} used.`;
  const roomiest = bound.filter(entry => entry.account.providerId === worst.account.providerId && entry.account !== worst.account
    && entry.view.tone === 'normal').sort((a, b) => a.window.usedPercent - b.window.usedPercent)[0];
  const others = bound.filter(entry => entry !== worst && entry.view.tone !== 'normal').length;
  return <p className="au-summary" data-tone={worst.view.tone} role="status">
    <Icon name={worst.view.tone === 'critical' ? 'AlertCircle' : 'AlertTriangle'} className="size-4" />
    <span><strong>{subject}</strong> {detail}
      {others > 0 && <span className="au-summary-hint"> {others === 1 ? '1 other account needs' : `${others} other accounts need`} attention.</span>}
      {roomiest && <span className="au-summary-hint"> {accountName(roomiest.account)} has the most room ({percent(roomiest.window.usedPercent)} of {roomiest.window.label.toLowerCase()}).</span>}
    </span>
  </p>;
}

export function UsageOverlay() {
  const open = useUsageOpen();
  const rpc = useRpc<typeof rpcContract>();
  const now = useNow(30_000, open);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
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
      if (mounted.current) { setSnapshot(next); setUpdatedAt(new Date()); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Usage could not be loaded');
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [rpc]);
  useEffect(() => { if (open) void refresh(false); }, [open, refresh]);
  const machines = (snapshot?.machines ?? []).map(machine => ({ ...machine,
    providers: machine.providers.filter(account => account.usage?.status !== 'not_installed') }))
    .filter(machine => machine.providers.length > 0 || machine.error !== null);
  const showMachines = machines.length > 1 || machines.some(machine => machine.status === 'disconnected');
  const age = updatedAt ? Math.max(0, now.getTime() - updatedAt.getTime()) : null;
  return <Dialog open={open} onOpenChange={value => { if (!value) closeUsage(); }}>
    <DialogContent className="au-overlay" hideCloseButton tabIndex={-1} onOpenAutoFocus={event => {
      // Focus the panel rather than its first button, so opening does not paint a focus ring on Refresh.
      event.preventDefault();
      (event.currentTarget as HTMLElement | null)?.focus();
    }} onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) || !event.currentTarget.contains(event.target as Node)) return;
      if (event.key === 'q' || event.key === 'Q') { event.preventDefault(); event.stopPropagation(); closeUsage(); }
    }} onCloseAutoFocus={event => { event.preventDefault(); restoreUsageFocus(); }}>
      <header className="au-head">
        <div className="au-head-title">
          <DialogTitle>Agent usage</DialogTitle>
          <DialogDescription>
            {loading && !snapshot ? 'Checking providers…' : loading ? 'Refreshing…'
              : age === null ? 'Not yet checked' : age < 60_000 ? 'Updated just now' : `Updated ${duration(age)} ago`}
          </DialogDescription>
        </div>
        <button className="au-icon-button" type="button" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => void refresh(true)}>
          <span className="au-spin" data-spinning={loading || undefined}><Icon name="ArrowReloadHorizontal" className="size-4" /></span>
        </button>
        <DialogClose className="au-icon-button" aria-label="Close" title="Close"><Icon name="X" className="size-4" /></DialogClose>
      </header>
      <div className="au-body" aria-busy={loading}>
        {error && <p role="alert" className="au-notice" data-tone="critical"><Icon name="AlertCircle" className="size-4" />{snapshot ? 'Showing previous figures. ' : ''}{error}</p>}
        {!snapshot && !error && <div className="au-skeleton" role="status" aria-label="Loading usage"><span /><span /><span /></div>}
        {snapshot && machines.length === 0 && <p className="au-empty" role="status">No usage sources reported. Enable Provider usage in BB’s plugin settings.</p>}
        {snapshot && <Summary accounts={machines.flatMap(machine => machine.providers)} now={now} />}
        {machines.map(machine => <section className="au-machine" key={machine.id} aria-label={machine.displayName}>
          {showMachines && <h2 className="au-machine-heading">
            <Icon name="Laptop" className="size-3.5" />{machine.displayName}
            {machine.status === 'disconnected' && <span className="au-pill">Offline</span>}
          </h2>}
          {machine.error && <p className="au-notice" data-tone="warning" role="status"><Icon name="AlertTriangle" className="size-3.5" />{machine.error} Some figures may be out of date.</p>}
          {byProvider(machine.providers).map(accounts => <ProviderGroup key={accounts[0]!.providerId} accounts={accounts} now={now} />)}
        </section>)}
      </div>
      <footer className="au-foot">
        <span className="au-legend"><span className="au-legend-mark" aria-hidden="true" />Even pace: where steady use would be by now</span>
        <span><kbd>Q</kbd> or <kbd>Esc</kbd> to close</span>
      </footer>
    </DialogContent>
  </Dialog>;
}

function headerTitle(header: Header | null, error: string | null, now: Date): string {
  if (error) return `${error}\nClick to see all accounts.`;
  if (!header) return 'Loading usage…';
  const lines = header.windows.map(window => {
    const view = viewWindow(window, now);
    return [`${window.label}: ${view.pace.kind === 'elapsed' ? 'reset since last check' : `${percent(window.usedPercent)} used`}`,
      view.pace.kind === 'elapsed' ? '' : view.status, view.reset ? `resets ${view.reset}` : ''].filter(Boolean).join(' · ');
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
  const binding = header ? bindingWindow(header.windows, now) : null;
  const title = headerTitle(header, error, now);
  const short = binding?.window.period ? SHORT[binding.window.period] : binding?.window.label;
  const text = !binding ? null
    : binding.view.pace.kind === 'limited' ? `${short} limit · back ${clock(binding.view.pace.resetsAt, now)}`
    : binding.view.pace.kind === 'paced' && binding.view.pace.runsOutAt ? `${short} ${percent(binding.window.usedPercent)} · out ${clock(binding.view.pace.runsOutAt, now)}`
    : `${short} ${percent(binding.window.usedPercent)}`;
  return <button type="button" className="au-badge" data-tone={binding?.view.tone ?? 'normal'} aria-label={`Open all agent usage. ${title}`}
    title={title} aria-haspopup="dialog" onClick={openUsage}>
    {binding ? <Ring window={binding.window} view={binding.view} /> : <Icon name="ChartColumn" className="size-3.5" />}
    {!isCompactViewport && (text ? <span className="au-badge-text">{text}</span>
      : error || header ? <span className="au-badge-muted">Usage</span> : null)}
  </button>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'usage', title: 'Provider usage', component: ThreadUsage });
  app.slots.experimental_appOverlay({ id: 'overview', component: UsageOverlay });
  app.commands.register({ id: 'open', title: 'Agent usage: show all accounts', defaultShortcut: { key: 'a', mod: true, shift: true }, run: openUsage });
});
