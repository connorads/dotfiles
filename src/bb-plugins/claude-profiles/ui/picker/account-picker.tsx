import { useCallback, useEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { ChipPopover } from '@bb-plugins/chip';
import { AccountConnector, ConnectorControls, useConnectorSettings } from './connectors.tsx';
import { toast } from 'sonner';
import type { Profile, rpcContract } from '../../contracts.ts';
import type { Usage } from '../../src/accounts/quota.ts';
import type { UsageWindow } from '../../src/accounts/usage/contract.ts';
import { percent, readingAge, readingState, viewWindow } from '../../src/accounts/usage/format.ts';
import { pace, periodStart } from '../../src/accounts/usage/pace.ts';
import { useNow } from '../usage/use-now.ts';
import { accountUnavailable, isClaude } from '../account-status.tsx';
import './picker.css';
import './account-picker.css';

function Quota({ usage, now }: { usage: Usage | undefined; now: Date }) {
  if (!usage) return <span className="ap-note">Loading usage…</span>;
  if (usage.status !== 'ok' || !usage.windows.length) return <span className="ap-note">{usage.message ?? 'Usage unavailable'}</span>;
  const windows: UsageWindow[] = usage.windows.map(window => ({ ...window,
    period: window.id === 'five_hour' ? 'five-hour' : window.id.startsWith('seven_day') ? 'week' : null }));
  const reading = readingState(usage.observedAt, windows, now);
  return <span className="ap-quotas">
    {windows.map((window, index) => {
      const view = viewWindow(window, now, reading);
      const timed = pace(window, now);
      const elapsed = timed.kind === 'early' || timed.kind === 'paced' ? timed.expectedPercent
        : timed.kind === 'limited' && window.period !== null
          ? Math.max(0, Math.min(100, (now.getTime() - periodStart(window.period, timed.resetsAt).getTime())
            / (timed.resetsAt.getTime() - periodStart(window.period, timed.resetsAt).getTime()) * 100)) : null;
      const resetPassed = timed.kind === 'elapsed';
      return <span className="ap-window" key={usage.windows[index]?.id} data-tone={view.tone}>
        <span className="ap-window-head"><span>{window.period === 'five-hour' ? '5 hours' : window.label === 'Seven days' ? '7 days' : window.label}</span>
          <span>{resetPassed ? 'Refresh needed' : `${percent(window.usedPercent)} used`}</span>
          <span className="ap-elapsed">{elapsed === null ? '' : `${percent(elapsed)} elapsed`}</span></span>
        {!resetPassed && <span className="ap-meter" aria-hidden="true" data-stale={reading !== 'fresh' || undefined}>
          <span className="ap-fill" style={{ width: `${Math.min(100, window.usedPercent)}%` }} />
          {elapsed !== null && <span className="ap-time" style={{ left: `${elapsed}%` }} />}
        </span>}
        <span className="ap-window-meta"><span>{view.status}</span><span>{view.reset ?? 'Reset time unavailable'}</span></span>
      </span>;
    })}
    <span className="ap-note">{readingAge(usage.observedAt, now)}{reading === 'stale' && ' · refresh needed'}</span>
  </span>;
}

export function AccountPicker({ composer, onClose }: { composer: PluginComposerApi; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const now = useNow(30_000);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState('default');
  const [quotas, setQuotas] = useState<Record<string, Usage>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const claude = isClaude(composer);
  const connectors = useConnectorSettings(threadId);
  const blocked = !claude || !supported || busy || composer.isRunning || composer.isSubmitting;
  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    if (!claude) { setProfiles([]); setSupported(false); setLoading(false); return; }
    try {
      const accounts = await rpc.call('accounts', { threadId });
      if (request !== generation.current) return;
      setSupported(accounts.supported);
      if (!accounts.supported) { setProfiles([]); return; }
      setProfiles(accounts.profiles); setCurrentId(accounts.currentId);
      for (const profile of accounts.profiles) {
        const reading = threadId === null ? rpc.call('nextThreadQuota', { profileId: profile.id })
          : rpc.call('usage', { threadId, profileId: profile.id, refresh });
        void reading.then(usage => {
          if (request === generation.current) setQuotas(previous => ({ ...previous, [profile.id]: usage }));
        }, () => {
          if (request === generation.current) setQuotas(previous => ({ ...previous,
            [profile.id]: { status: 'error', windows: [], observedAt: null, message: 'Usage unavailable' } }));
        });
      }
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load accounts.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [rpc, threadId, claude]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load, composer.isRunning]);
  useRealtime('profiles-changed', () => { void load(); });
  const focused = useRef(false);
  useEffect(() => {
    if (loading || focused.current || !profiles.length) return;
    focused.current = true;
    dialog.current?.querySelector<HTMLButtonElement>('[data-current] [data-account]')?.focus();
  }, [loading, profiles]);
  useEffect(() => {
    const reveal = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[data-profile]') && dialog.current?.contains(active)) {
        active.scrollIntoView?.({ block: 'nearest' });
      }
    };
    reveal(); window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [quotas]);
  async function choose(profile: Profile) {
    if (blocked || working.current) return;
    if (profile.id === currentId) { onClose(); return; }
    working.current = true; setBusy(true); setError(null);
    try {
      await rpc.call('choose', { threadId, profileId: profile.id });
      toast.success(`Claude account: ${profile.label}`); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not switch account.'); }
    finally { working.current = false; setBusy(false); }
  }
  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') { event.preventDefault(); if (!working.current) onClose(); return; }
    const target = event.target;
    const group = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-profile]') : null;
    if (/^[1-9]$/.test(event.key) && (group || target === event.currentTarget)) {
      event.preventDefault(); const profile = profiles[Number(event.key) - 1]; if (profile) void choose(profile);
      return;
    }
    if (!group || !(target instanceof HTMLButtonElement)) return;
    const onConnector = target.getAttribute('role') === 'switch';
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-profile]') ?? []);
      const index = rows.indexOf(group);
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
        ?.querySelector<HTMLButtonElement>(onConnector ? '[role="switch"]' : '[data-account]');
      next?.focus(); next?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      group.querySelector<HTMLButtonElement>(event.key === 'ArrowRight' ? '[role="switch"]' : '[data-account]')?.focus();
    } else if (event.key.toLowerCase() === 'c') {
      event.preventDefault(); group.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
    } else if (event.key === 'Enter' && target.hasAttribute('data-account')) {
      event.preventDefault(); target.click();
    }
  }
  return <ChipPopover ref={dialog} tabIndex={-1} aria-label="Switch Claude account"
    trigger={() => null} anchor={null} width={580} instant panelClassName="ap-panel"
    onKeyDown={keyboard} onClose={() => { if (!working.current) onClose(); }}>
    <div className="mf-picker">
      <header className="ap-head"><span><Icon name="Users" className="ap-icon" /><strong>Claude accounts</strong></span>
        <button className="mf-dismiss" type="button" aria-label="Close account picker" disabled={busy} onClick={onClose}><kbd className="mf-kbd">esc</kbd></button></header>
      {!loading && !supported && <p role="status" className="ap-notice">{accountUnavailable}</p>}
      {supported && <ConnectorControls controls={connectors} threadId={threadId} disabled={blocked} />}
      {error && <p role="alert" className="mf-error">{error} <button type="button" disabled={busy} onClick={() => { void load(true); }}>Retry</button></p>}
      {(composer.isRunning || composer.isSubmitting) && <p role="status" className="ap-notice">Stop the turn and clear queued messages before switching.</p>}
      <div className="ap-intro"><span>Accounts <span className="ap-count">{profiles.length || ''}</span></span>
        <span className="ap-legend"><i /> Time elapsed</span>
        <button type="button" className="ap-refresh" disabled={loading || busy} onClick={() => { void load(true); }} aria-label="Refresh account usage"><Icon name="ArrowReloadHorizontal" className="ap-icon" /></button></div>
      <div className="ap-list" aria-busy={loading || busy}>
        {loading && !profiles.length && <p className="ap-note" role="status">Loading accounts…</p>}
        {!loading && !profiles.length && !error && supported && <p className="ap-note">No Claude accounts found.</p>}
        {profiles.map((profile, index) => <section key={profile.id} className="ap-account-group" data-profile={profile.id}
          data-current={profile.id === currentId || undefined} aria-label={`${profile.label} account`}>
          <div className="ap-account-head"><button type="button" data-account={profile.id}
            className="ap-account" aria-label={`Switch to ${profile.label}`}
            aria-disabled={blocked || undefined} aria-current={profile.id === currentId || undefined}
            onClick={() => { void choose(profile); }}>
            <kbd className="mf-kbd">{index < 9 ? index + 1 : '↵'}</kbd><strong>{profile.label}</strong>
              {profile.id === currentId && <span className="ap-current"><Icon name="Check" className="ap-icon" />Current</span>}
          </button><AccountConnector controls={connectors} profile={profile} /></div>
          <Quota usage={quotas[profile.id]} now={now} />
        </section>)}
      </div>
      <footer className="mf-footer ap-footer">{supported && <><span><kbd className="mf-kbd">↑↓</kbd> account</span><span><kbd className="mf-kbd">←→</kbd> control</span>
        <span><kbd className="mf-kbd">C</kbd> connectors</span><span><kbd className="mf-kbd">1-9</kbd> switch</span></>}
        <span>{busy ? 'Switching…' : <><kbd className="mf-kbd">↵</kbd> select</>}</span></footer>
    </div>
  </ChipPopover>;
}
