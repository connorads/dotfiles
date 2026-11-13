import { BrandIcon } from './brand-icon.tsx';
import { RollingValue } from './rolling-value.tsx';
import { AmpUsage } from './amp.tsx';
import type { AmpOverview } from '../../src/accounts/usage/amp-reading.ts';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { experimental_ProviderIcon as ProviderIcon, useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog.tsx';
import { Icon } from '../components/ui/icon.tsx';
import type { rpcContract } from '../../contracts.ts';
import type { Account, Inspection, UsageWindow } from '../../src/accounts/usage/contract.ts';
import { duration, expiryClock, percent, readingAge, readingState, viewWindow, type ReadingState, type WindowView } from '../../src/accounts/usage/format.ts';
import type { ResetCredits } from '../../src/accounts/usage/reset-credits.ts';
import type { ClaudeResets } from '../../src/accounts/usage/claude-resets.ts';
import { closeUsage, restoreUsageFocus, useUsageOpen } from './overlay-store.ts';
import { useNow } from './use-now.ts';
import './usage.css';
import { openCodeAccountHost } from '../../src/accounts/usage/opencode.ts';

function Meter({ window, view, stale = false }: { window: UsageWindow; view: WindowView; stale?: boolean }) {
  const elapsed = view.pace.kind === 'elapsed';
  const fill = elapsed ? 0 : Math.min(100, Math.max(0, window.usedPercent));
  const marker = view.pace.kind === 'paced' || view.pace.kind === 'early' ? view.pace.expectedPercent : null;
  return <span className="au-meter" data-tone={view.tone} data-elapsed={elapsed || undefined} data-stale={stale || undefined} aria-hidden="true">
    <span className="au-meter-fill" style={{ transform: `scaleX(${fill / 100})` }} />
    <span className="au-meter-sheen" />
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
    <span className="au-row-value" role="cell" data-tone={view.tone}>{view.pace.kind === 'elapsed' ? '–' : <RollingValue value={percent(window.usedPercent)} />}</span>
    {/* The bar's fill, colour and pace marker show the pace, so the row ends in one phrase the bar cannot show. */}
    <span className="au-row-detail" role="cell" data-tone={view.tone} title={view.reset ?? undefined}>{view.detail ?? ''}</span>
  </div>;
}

function accountName(account: Account): string {
  return account.accountLabel ?? (account.usage?.status === 'ok' ? account.usage.accountEmail : null) ?? account.displayName;
}

function AccountBlock({ account, now, observedAt, resetCredits, claudeResets, hostId, connected }: { account: Account; now: Date; observedAt: number | null;
  resetCredits: ResetCredits | null; claudeResets: ClaudeResets | null; hostId: string; connected: boolean }) {
  const navigate = useBbNavigate();
  const usage = account.usage;
  const name = accountName(account);
  const go = openCodeAccountHost(account.id) !== null;
  const canLogin = (usage?.status === 'expired' || usage?.status === 'unauthenticated')
    && (account.providerId === 'claude-code' && (account.id.startsWith('claude-profiles:') || account.id.startsWith('provider-claude-code:'))
      || account.providerId === 'codex' && account.id.startsWith('provider-codex:')
      || go);
  const email = usage?.status === 'ok' && usage.accountEmail !== name ? usage.accountEmail : null;
  const reading = readingState(observedAt, usage?.status === 'ok' ? usage.windows : [], now);
  const message = canLogin && connected ? (go ? 'Go usage unavailable. Check OpenCode Console.' : usage?.status === 'expired' ? 'Session expired' : 'Not signed in')
    : usage === null ? 'Usage not reported'
    : usage.status === 'unauthenticated' ? account.signInHint
    : usage.status === 'expired' ? account.expiredHint
    : usage.status === 'error' ? usage.message
    : usage.status === 'ok' && usage.windows.length === 0 ? 'No limits reported' : null;
  const plan = usage?.status === 'ok' ? usage.planLabel : null;
  return <section className="au-account" aria-label={`${account.displayName} · ${name}`}>
    {/* The provider heading already names an account that has no label, plan or email of its own. */}
    {(name !== account.displayName || plan || email) && <header className="au-account-heading">
      <span className="au-account-name">{name}</span>
      {plan && <span className="au-plan">{plan}</span>}
      {email && <span className="au-email">{email}</span>}
    </header>}
    {message ? <div className="au-account-message"><span data-tone={canLogin && connected ? 'warning' : undefined}>{message}</span>
      {canLogin && <button type="button" className="au-login-button" disabled={!connected}
        title={connected ? `Sign in to ${name} on this machine` : 'Connect this machine before signing in'}
        aria-label={`Sign in again to ${name}`} onClick={() => {
          closeUsage();
          // BB encodes route segments; pass the target without URL encoding.
          navigate.toPluginPanel('claude-login', { subPath: JSON.stringify({ hostId, accountId: account.id }) });
        }}>{go ? 'Connect Go' : 'Sign in again'}</button>}
    </div>
      : usage?.status === 'ok' && <div role="table" aria-label={`${name} limits`} className="au-rows">
        {usage.windows.map(window => <WindowRow key={window.label} window={window} now={now} reading={reading} />)}
      </div>}
    {resetCredits && <CreditResets reading={resetCredits} now={now} accountEmail={usage?.status === 'ok' ? usage.accountEmail : null}
      signedOut={usage?.status === 'expired' || usage?.status === 'unauthenticated'} />}
    {claudeResets && usage?.status === 'ok' && <ClaudeResetRows reading={claudeResets} now={now} />}
    {usage?.status === 'ok' && reading !== 'fresh' && <p className="au-reading" data-stale={reading === 'stale' || undefined} title={observedAt === null ? undefined : new Date(observedAt).toLocaleString()}>
      {readingAge(observedAt, now)}{reading === 'stale' && ' · refresh needed'}
    </p>}
  </section>;
}

function ResetCount({ count }: { count: number }) {
  return <span className="au-resets-held" role="cell">
    {count <= 12 && <span className="au-pips" aria-hidden="true">{Array.from({ length: count }, (_, index) => <span key={index} />)}</span>}
    <span>{count} saved</span>
  </span>;
}

function ClaudeResetRows({ reading, now }: { reading: ClaudeResets; now: Date }) {
  if (reading.status === 'ok' && reading.groups.length === 0 && !reading.message) return null;
  const stale = reading.status === 'ok' && now.getTime() - reading.observedAt >= 15 * 60_000;
  return <div role="table" aria-label="Claude saved resets" className="au-rows au-resets">
    {reading.status === 'unavailable' ? <div className="au-row" role="row">
      <span className="au-row-label" role="rowheader">Saved resets</span>
      <span className="au-resets-note" role="cell">{reading.message}</span>
    </div> : <>
      {reading.groups.map(group => {
        const deadline = group.expiresAt === null ? null : new Date(group.expiresAt);
        const expired = deadline !== null && deadline <= now;
        const soon = deadline !== null && deadline.getTime() - now.getTime() <= 3 * 86_400_000;
        const detail = deadline === null ? 'Expiry unavailable' : expired ? 'Expiry passed'
          : `Expires in ${duration(deadline.getTime() - now.getTime())}`;
        const availability = group.paused ? 'Paused' : group.usable < group.count ? `${group.usable} usable now` : null;
        const title = [deadline && expiryClock(deadline), availability,
          group.label === 'Fable reset' && 'Returns weekly Fable usage and refills the session limit.'].filter(Boolean).join(' · ');
        return <div className="au-row" role="row" key={JSON.stringify([group.label, group.expiresAt, group.paused])}
          aria-label={`${group.label}: ${group.count} saved. ${detail}.${availability ? ` ${availability}.` : ''}`}>
          <span className="au-row-label" role="rowheader" title={title}>{group.label}</span>
          <ResetCount count={group.count} />
          <span role="cell" />
          <span className="au-row-detail" role="cell" data-tone={expired || soon ? 'warning' : undefined} title={title}>
            {detail}{availability && <span className="au-reset-availability">{availability}</span>}
          </span>
        </div>;
      })}
      {(stale || reading.message) && <p className="au-resets-note au-resets-foot" data-stale={stale || undefined}>
        {[stale && `${readingAge(reading.observedAt, now)} · refresh needed`, reading.message].filter(Boolean).join(' · ')}
      </p>}
    </>}
  </div>;
}

function CreditResets({ reading, now, accountEmail, signedOut }: { reading: ResetCredits; now: Date; accountEmail: string | null; signedOut: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (reading.status === 'ok' && reading.held === 0 && !reading.message) return null;
  if (reading.status === 'unavailable') return <div role="table" aria-label="Codex reset credits" className="au-rows au-resets">
    <div className="au-row" role="row">
      <span className="au-row-label" role="rowheader">Reset credits</span>
      <span className="au-resets-note" role="cell">{reading.message}</span>
    </div>
  </div>;
  const first = reading.expiries[0];
  const deadline = first ? new Date(first.expiresAt) : null;
  const expired = deadline !== null && deadline <= now;
  const soon = deadline !== null && deadline.getTime() - now.getTime() <= 3 * 86_400_000;
  const stale = now.getTime() - reading.observedAt >= 15 * 60_000;
  const next = deadline === null ? null : expired ? 'Expiry passed' : `Expires in ${duration(deadline.getTime() - now.getTime())}`;
  // One expiry date is already the row's detail; a list only earns space when it adds dates.
  const listed = reading.expiries.length > 1 || (reading.expiries.length > 0 && reading.unknownExpiryCount > 0);
  const source = reading.accountLabel !== null && reading.accountLabel !== accountEmail ? reading.accountLabel : null;
  const plural = (count: number) => `${count} ${count === 1 ? 'reset' : 'resets'}`;
  return <div role="table" aria-label="Codex reset credits" className="au-rows au-resets">
    <div className="au-row" role="row" aria-label={`Reset credits: ${reading.held} saved.${
      next && deadline ? ` ${next}, ${expiryClock(deadline)}.` : ''}`}>
      <span className="au-row-label" role="rowheader">Reset credits</span>
      <ResetCount count={reading.held} />
      <span role="cell" />
      <span className="au-row-detail" role="cell" data-tone={expired || soon ? 'warning' : undefined} title={deadline ? expiryClock(deadline) : undefined}>
        {listed ? <button type="button" className="au-resets-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
          {next}<Icon name="ChevronDown" className="au-resets-chevron size-3" />
        </button> : next ?? ''}
      </span>
    </div>
    {listed && open && <div id={listId} role="rowgroup" className="au-resets-list">
      {reading.expiries.map(expiry => {
        const date = new Date(expiry.expiresAt);
        return <div key={expiry.expiresAt} className="au-row au-resets-expiry" role="row">
          <span role="cell" />
          <span role="cell">{plural(expiry.count)} · {expiryClock(date)}</span>
          <span role="cell" />
          <span className="au-row-detail" role="cell">{date <= now ? 'Expired' : `in ${duration(date.getTime() - now.getTime())}`}</span>
        </div>;
      })}
      {reading.unknownExpiryCount > 0 && <div className="au-row au-resets-expiry" role="row">
        <span role="cell" /><span role="cell">{plural(reading.unknownExpiryCount)} · expiry unavailable</span>
      </div>}
    </div>}
    {/* A signed-out login cannot refresh, so sign-in is the only fix and the collector's details add nothing. */}
    {signedOut ? stale && <p className="au-resets-note au-resets-foot" title={new Date(reading.observedAt).toLocaleString()}>
      {readingAge(reading.observedAt, now)} · updates after sign-in
    </p> : (source || stale || reading.message) && <p className="au-resets-note au-resets-foot" data-stale={stale || undefined} role={reading.message ? 'status' : undefined}
      title={new Date(reading.observedAt).toLocaleString()}>
      {[source && `From CLI login · ${source}`, stale && `${readingAge(reading.observedAt, now)} · refresh needed`, reading.message].filter(Boolean).join(' · ')}
    </p>}
  </div>;
}

function ProviderGroup({ accounts, now, readings, resetCredits, claudeResets, hostId, connected }: { accounts: Account[]; now: Date;
  readings: Inspection['readings']; resetCredits: ResetCredits | null; claudeResets: Inspection['claudeResets']; hostId: string; connected: boolean }) {
  const [first] = accounts;
  if (!first) return null;
  return <section className="au-provider" aria-label={first.displayName}>
    <h3 className="au-provider-heading">
      <>{first.providerId === 'acp-grok' ? <BrandIcon brand="grok" />
        : <ProviderIcon providerKind="agent" provider={{ ...first, id: first.providerId }} fallback="Bot" className="size-4" />}</>
      {first.displayName}
    </h3>
    {/* Reset credits belong to the CLI login, which is the machine's one Codex account. */}
    <div className="au-provider-card">{accounts.map(account => <AccountBlock key={account.id} account={account} now={now} hostId={hostId} connected={connected}
      observedAt={readings.find(reading => reading.accountId === account.id)?.observedAt ?? null}
      claudeResets={claudeResets.find(reading => reading.accountId === account.id)?.reading ?? null}
      resetCredits={account === first && first.providerId === 'codex' ? resetCredits : null} />)}
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
      <header className="au-head" data-refreshing={loading || undefined}>
        <div className="au-head-title">
          <DialogTitle>Agent usage</DialogTitle>
          <DialogDescription>
            {loading && !snapshot ? 'Checking providers…' : loading ? 'Refreshing…'
              : inspection === null ? 'Not yet checked' : 'Quota resets and credit expiries · local time'}
          </DialogDescription>
        </div>
        <button className="au-icon-button" type="button" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => { void refresh(true); }}>
          <Icon name="ArrowReloadHorizontal" className="size-4" />
        </button>
        <DialogClose className="au-icon-button" aria-label="Close" title="Close"><Icon name="X" className="size-4" /></DialogClose>
      </header>
      <div ref={scrollArea} className="au-body" role="region" aria-label="Usage details" tabIndex={-1} aria-busy={loading}>
        {error && <p role="alert" className="au-notice" data-tone="critical"><Icon name="AlertCircle" className="size-4" />{snapshot ? 'Showing previous figures. ' : ''}{error}</p>}
        {quotaLoading && !snapshot && !error && <div className="au-skeleton" role="status" aria-label="Loading usage"><span /><span /><span /></div>}
        {snapshot && machines.length === 0 && <p className="au-empty" role="status">No usage sources reported. Enable Provider usage in BB’s plugin settings.</p>}
        {machines.map(machine => <section className="au-machine" data-refreshing={quotaLoading || undefined} key={machine.id} aria-label={machine.displayName}>
          {showMachines && <h2 className="au-machine-heading">
            <Icon name="Laptop" className="size-3.5" />{machine.displayName}
            {machine.status === 'disconnected' && <span className="au-pill">Offline</span>}
          </h2>}
          {machine.error && <p className="au-notice" data-tone="warning" role="status"><Icon name="AlertTriangle" className="size-3.5" />{machine.error} Some figures may be out of date.</p>}
          {byProvider(machine.providers).map(accounts => <ProviderGroup key={accounts[0]!.providerId} accounts={accounts} now={now}
            hostId={machine.id} connected={machine.status === 'connected'}
            claudeResets={inspection?.claudeResets ?? []}
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
