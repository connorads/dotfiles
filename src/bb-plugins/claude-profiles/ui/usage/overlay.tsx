import { AmpUsage } from './amp.tsx';
import type { AmpOverview } from '../../src/accounts/usage/amp-reading.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { experimental_ProviderIcon as ProviderIcon, useRpc } from '@get-bb/plugin-sdk/app';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog.tsx';
import { Icon } from '../components/ui/icon.tsx';
import type { rpcContract } from '../../contracts.ts';
import type { Account, Inspection, UsageWindow } from '../../src/accounts/usage/contract.ts';
import { duration, expiryClock, percent, readingAge, readingState, viewWindow, type ReadingState, type WindowView } from '../../src/accounts/usage/format.ts';
import type { ResetCredits } from '../../src/accounts/usage/reset-credits.ts';
import { closeUsage, restoreUsageFocus, useUsageOpen } from './overlay-store.ts';
import { useNow } from './use-now.ts';
import './usage.css';

function Meter({ window, view, stale = false }: { window: UsageWindow; view: WindowView; stale?: boolean }) {
  const elapsed = view.pace.kind === 'elapsed';
  const fill = elapsed ? 0 : Math.min(100, Math.max(0, window.usedPercent));
  const marker = view.pace.kind === 'paced' || view.pace.kind === 'early' ? view.pace.expectedPercent : null;
  return <span className="au-meter" data-tone={view.tone} data-elapsed={elapsed || undefined} data-stale={stale || undefined} aria-hidden="true">
    <span className="au-meter-fill" style={{ width: `${fill}%` }} />
    {marker !== null && <span className="au-meter-pace" style={{ left: `${marker}%` }} />}
  </span>;
}

function WindowRow({ window, now, reading }: { window: UsageWindow; now: Date; reading: ReadingState }) {
  const view = viewWindow(window, now, reading);
  const expected = view.pace.kind === 'paced' || view.pace.kind === 'early' ? ` Even pace would be ${percent(view.pace.expectedPercent)}.` : '';
  const description = view.pace.kind === 'elapsed' ? view.status : `${percent(window.usedPercent)} used. ${view.status}`;
  return <div className="au-row" role="row" aria-label={`${window.label}: ${description}.${expected}`}>
    <span className="au-row-label" role="rowheader">{window.label}</span>
    <span className="au-row-meter" role="cell"><Meter window={window} view={view} stale={reading === 'stale'} /></span>
    <span className="au-row-value" role="cell" data-tone={view.tone}>{view.pace.kind === 'elapsed' ? '–' : percent(window.usedPercent)}</span>
    {/* The bar's fill, colour and pace marker show the pace, so the row ends in one phrase the bar cannot show. */}
    <span className="au-row-detail" role="cell" data-tone={view.tone} title={view.reset ?? undefined}>{view.detail ?? ''}</span>
  </div>;
}

function accountName(account: Account): string {
  return account.accountLabel ?? (account.usage?.status === 'ok' ? account.usage.accountEmail : null) ?? account.displayName;
}

function AccountBlock({ account, now, observedAt }: { account: Account; now: Date; observedAt: number | null }) {
  const usage = account.usage;
  const name = accountName(account);
  const email = usage?.status === 'ok' && usage.accountEmail !== name ? usage.accountEmail : null;
  const reading = readingState(observedAt, usage?.status === 'ok' ? usage.windows : [], now);
  const message = usage === null ? 'Usage not reported'
    : usage.status === 'unauthenticated' ? account.signInHint
    : usage.status === 'expired' ? account.expiredHint
    : usage.status === 'error' ? usage.message
    : usage.status === 'ok' && usage.windows.length === 0 ? 'No limits reported' : null;
  return <section className="au-account" aria-label={`${account.displayName} · ${name}`}>
    <header className="au-account-heading">
      <span className="au-account-name">{name}</span>
      {usage?.status === 'ok' && usage.planLabel && <span className="au-plan">{usage.planLabel}</span>}
      {email && <span className="au-email">{email}</span>}
    </header>
    {message ? <p className="au-account-message">{message}</p>
      : usage?.status === 'ok' && <div role="table" aria-label={`${name} limits`} className="au-rows">
        {usage.windows.map(window => <WindowRow key={window.label} window={window} now={now} reading={reading} />)}
      </div>}
    {usage?.status === 'ok' && reading !== 'fresh' && <p className="au-reading" data-stale={reading === 'stale' || undefined} title={observedAt === null ? undefined : new Date(observedAt).toLocaleString()}>
      {readingAge(observedAt, now)}{reading === 'stale' && ' · refresh needed'}
    </p>}
  </section>;
}

function CreditResets({ reading, now }: { reading: ResetCredits; now: Date }) {
  if (reading.status === 'ok' && reading.held === 0 && !reading.message) return null;
  if (reading.status === 'unavailable') return <section className="au-resets" aria-label="Codex reset credits">
    <p className="au-reading">Reset credits unavailable · {reading.message}</p>
  </section>;
  const first = reading.expiries[0];
  const deadline = first ? new Date(first.expiresAt) : null;
  const expired = deadline !== null && deadline <= now;
  const soon = deadline !== null && deadline.getTime() - now.getTime() <= 3 * 86_400_000;
  const stale = now.getTime() - reading.observedAt >= 15 * 60_000;
  return <section className="au-resets" aria-label="Codex reset credits">
    <div className="au-resets-heading">
      <div><h4>Reset credits <span className="au-resets-count">{reading.held} held</span></h4>
        <p className="au-reading">{reading.usable} usable at last check</p></div>
      {deadline && <p className="au-resets-next" data-tone={soon ? 'warning' : 'normal'}>
        {expired ? 'Expiry passed · refresh needed' : `Next expires in ${duration(deadline.getTime() - now.getTime())}`}
        <span>{expiryClock(deadline)}</span>
      </p>}
    </div>
    <p className="au-reading au-resets-source">CLI login{reading.accountLabel ? ` · ${reading.accountLabel}` : ' · account not reported'}</p>
    <details className="au-expiries">
      <summary>Expiry dates</summary>
      <ul>{reading.expiries.map(expiry => {
        const date = new Date(expiry.expiresAt);
        return <li key={expiry.expiresAt}><span>{expiry.count} {expiry.count === 1 ? 'reset' : 'resets'}</span>
          <span>{expiryClock(date)}<small>{date <= now ? 'Expired · refresh needed' : `In ${duration(date.getTime() - now.getTime())}`}</small></span></li>;
      })}
        {reading.unknownExpiryCount > 0 && <li>{reading.unknownExpiryCount} {reading.unknownExpiryCount === 1 ? 'reset' : 'resets'} · expiry unavailable</li>}
      </ul>
    </details>
    <p className="au-reading" data-stale={stale || undefined} title={new Date(reading.observedAt).toLocaleString()}>
      {readingAge(reading.observedAt, now)}{stale && ' · refresh needed'}
    </p>
    {reading.message && <p className="au-reading" role="status">{reading.message}</p>}
  </section>;
}

function ProviderGroup({ accounts, now, readings, resetCredits }: { accounts: Account[]; now: Date;
  readings: Inspection['readings']; resetCredits: ResetCredits | null }) {
  const [first] = accounts;
  if (!first) return null;
  return <section className="au-provider" aria-label={first.displayName}>
    <h3 className="au-provider-heading">
      <ProviderIcon providerKind="agent" provider={{ ...first, id: first.providerId }} fallback="Bot" className="size-4" />
      {first.displayName}
    </h3>
    <div className="au-provider-card">{accounts.map(account => <AccountBlock key={account.id} account={account} now={now}
      observedAt={readings.find(reading => reading.accountId === account.id)?.observedAt ?? null} />)}
      {first.providerId === 'codex' && resetCredits && <CreditResets reading={resetCredits} now={now} />}
    </div>
  </section>;
}

function byProvider(accounts: Account[]): Account[][] {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) groups.set(account.providerId, [...groups.get(account.providerId) ?? [], account]);
  return [...groups.values()];
}

export function UsageOverlay() {
  const open = useUsageOpen();
  const panel = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const rpc = useRpc<typeof rpcContract>();
  const now = useNow(30_000, open);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const snapshot = inspection?.snapshot ?? null;
  const [amp, setAmp] = useState<AmpOverview | null>(null);
  const [ampMessage, setAmpMessage] = useState<string | null>(null);
  const [ampLoading, setAmpLoading] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
        || !(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
        || !panel.current?.closest('[role="dialog"]')?.contains(target)) return;
      if (event.key === 'q' || event.key === 'Q') { event.preventDefault(); event.stopPropagation(); closeUsage(); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [open]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async (force: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    setQuotaLoading(true);
    setAmpLoading(true);
    setAmpMessage(null);
    await Promise.allSettled([
      rpc.call('usage.inspection', { refresh: force }).then(next => {
        if (mounted.current) setInspection(next);
      }).catch(cause => {
        if (mounted.current) setError(cause instanceof Error ? cause.message : 'Usage could not be loaded');
      }).finally(() => { if (mounted.current) setQuotaLoading(false); }),
      rpc.call('usage.amp', { refresh: force }).then(next => {
        if (mounted.current) setAmp(next);
      }).catch(() => {
        if (mounted.current) setAmpMessage('Amp usage could not be loaded.');
      }).finally(() => { if (mounted.current) setAmpLoading(false); }),
    ]);
    pending.current = false;
    if (mounted.current) setLoading(false);
  }, [rpc]);
  useEffect(() => {
    if (!open) return;
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 300_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);
  const machines = (snapshot?.machines ?? []).map(machine => ({ ...machine,
    providers: machine.providers.filter(account => account.usage?.status !== 'not_installed') }))
    .filter(machine => machine.providers.length > 0 || machine.error !== null);
  const showMachines = machines.length > 1 || machines.some(machine => machine.status === 'disconnected');
  return <Dialog open={open} onOpenChange={value => { if (!value) closeUsage(); }}>
    <DialogContent ref={panel} className="au-overlay" hideCloseButton tabIndex={-1} onOpenAutoFocus={event => {
      event.preventDefault();
      scrollArea.current?.focus();
    }} onCloseAutoFocus={event => { event.preventDefault(); }} onAfterCloseAutoFocus={restoreUsageFocus}>
      <header className="au-head">
        <div className="au-head-title">
          <DialogTitle>Agent usage</DialogTitle>
          <DialogDescription>
            {loading && !snapshot ? 'Checking providers…' : loading ? 'Refreshing…'
              : inspection === null ? 'Not yet checked' : 'Quota resets and credit expiries · local time'}
          </DialogDescription>
        </div>
        <button className="au-icon-button" type="button" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => { void refresh(true); }}>
          <span className="au-spin" data-spinning={loading || undefined}><Icon name="ArrowReloadHorizontal" className="size-4" /></span>
        </button>
        <DialogClose className="au-icon-button" aria-label="Close" title="Close"><Icon name="X" className="size-4" /></DialogClose>
      </header>
      <div ref={scrollArea} className="au-body" role="region" aria-label="Usage details" tabIndex={-1} aria-busy={loading}>
        {error && <p role="alert" className="au-notice" data-tone="critical"><Icon name="AlertCircle" className="size-4" />{snapshot ? 'Showing previous figures. ' : ''}{error}</p>}
        {quotaLoading && !snapshot && !error && <div className="au-skeleton" role="status" aria-label="Loading usage"><span /><span /><span /></div>}
        {snapshot && machines.length === 0 && <p className="au-empty" role="status">No usage sources reported. Enable Provider usage in BB’s plugin settings.</p>}
        {machines.map(machine => <section className="au-machine" key={machine.id} aria-label={machine.displayName}>
          {showMachines && <h2 className="au-machine-heading">
            <Icon name="Laptop" className="size-3.5" />{machine.displayName}
            {machine.status === 'disconnected' && <span className="au-pill">Offline</span>}
          </h2>}
          {machine.error && <p className="au-notice" data-tone="warning" role="status"><Icon name="AlertTriangle" className="size-3.5" />{machine.error} Some figures may be out of date.</p>}
          {byProvider(machine.providers).map(accounts => <ProviderGroup key={accounts[0]!.providerId} accounts={accounts} now={now}
            readings={inspection?.readings ?? []} resetCredits={inspection?.resetCredits.find(value => value.hostId === machine.id)?.reading ?? null} />)}
        </section>)}
        {(snapshot || error) && <AmpUsage value={amp} message={ampMessage} loading={ampLoading} now={now} />}
      </div>
      <footer className="au-foot">
        <span className="au-legend"><span className="au-legend-mark" aria-hidden="true" />Even pace: where steady use would be by now</span>
        <span><kbd>Q</kbd> or <kbd>Esc</kbd> to close</span>
      </footer>
    </DialogContent>
  </Dialog>;
}
