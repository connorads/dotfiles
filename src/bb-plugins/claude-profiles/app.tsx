import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract, Profile, Selection } from './contracts.ts';
import type { Usage } from './src/usage.ts';
import './app.css';

// The command runs outside React, so each mounted header registers how to open its own menu.
const openers = new Map<string, () => void>();
const shownWindows = [['five_hour', '5h'], ['seven_day', '7d']] as const;

function until(resetsAt: string | null) {
  if (!resetsAt) return null;
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - Date.now()) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function Quota({ usage }: { usage: Usage | undefined }) {
  if (!usage) return <span className="cp-quota cp-muted">Loading quota…</span>;
  const windows = shownWindows.flatMap(([id, label]) => {
    const window = usage.windows.find(item => item.id === id);
    return window ? [{ ...window, label }] : [];
  });
  if (!windows.length) return <span className="cp-quota cp-muted">{usage.message ?? 'Quota unavailable'}</span>;
  return <span className="cp-quota">{windows.map(window => {
    const used = Math.round(window.usedPercent);
    const reset = until(window.resetsAt);
    return <span key={window.id} className="cp-window" title={reset ? `Resets in ${reset}` : undefined}>
      <span className="cp-window-label">{window.label}</span>
      <span className="cp-bar"><span data-level={used >= 90 ? 'high' : used >= 70 ? 'warn' : 'ok'} style={{ width: `${Math.min(used, 100)}%` }} /></span>
      <span className="cp-pct">{used}%</span>
      {reset && <span className="cp-muted">{reset}</span>}
    </span>;
  })}</span>;
}

function ProfileControl({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<Record<string, Usage>>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Profile request failed.';
  const currentId = selection?.profile.id ?? 'default';
  const current = profiles.find(profile => profile.id === currentId);

  const load = useCallback(() => {
    rpc.call('thread', { threadId }).then(value => {
      setProfiles(value.profiles); setSelection(value.selection);
    }, cause => setError(message(cause)));
  }, [rpc, threadId]);
  useEffect(() => { setOpen(false); setQuotas({}); load(); }, [load]);
  useRealtime('profiles-changed', load);

  const measure = useCallback((list: Profile[], refresh: boolean) => {
    if (refresh) setQuotas({});
    for (const profile of list) {
      rpc.call('usage', { threadId, profileId: profile.id, refresh }).then(
        usage => setQuotas(previous => ({ ...previous, [profile.id]: usage })),
        cause => setQuotas(previous => ({ ...previous, [profile.id]: { status: 'error', windows: [], observedAt: null, message: message(cause) } })));
    }
  }, [rpc, threadId]);
  useEffect(() => { if (current) measure([current], false); }, [current?.id, measure]);

  const openMenu = useCallback(() => {
    setError(null); setOpen(true); measure(profiles, false);
  }, [measure, profiles]);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  useEffect(() => {
    if (!profiles.length) return;
    openers.set(threadId, openMenu);
    return () => { if (openers.get(threadId) === openMenu) openers.delete(threadId); };
  }, [threadId, openMenu, profiles.length]);
  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, profiles.findIndex(profile => profile.id === currentId));
    items.current[index]?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  async function choose(profile: Profile) {
    if (switching) return;
    if (profile.id === currentId) return close();
    setSwitching(profile.id); setError(null);
    try { setSelection(await rpc.call('switch', { threadId, profileId: profile.id })); close(); }
    catch (cause) { setError(message(cause)); }
    finally { setSwitching(null); }
  }
  function onKeyDown(event: KeyboardEvent) {
    const focused = items.current.findIndex(item => item === document.activeElement);
    const focus = (index: number) => items.current[(index + profiles.length) % profiles.length]?.focus();
    const digit = Number(event.key);
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown') focus(focused + 1);
    else if (event.key === 'ArrowUp') focus(focused - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(-1);
    else if ((event.key === 'Enter' || event.key === ' ') && profiles[focused]) void choose(profiles[focused]);
    else if (event.key === 'r' || event.key === 'R') measure(profiles, true);
    else if (Number.isInteger(digit) && profiles[digit - 1]) void choose(profiles[digit - 1]);
    else return;
    event.preventDefault(); event.stopPropagation();
  }

  if (!profiles.length) return null;
  const fiveHour = quotas[currentId]?.windows.find(window => window.id === 'five_hour');
  return <div className="claude-profiles" ref={root}>
    <button ref={trigger} className="cp-trigger" onClick={() => open ? close() : openMenu()} aria-haspopup="menu"
      aria-expanded={open} aria-label={`Claude account ${current?.label ?? 'Default'}`} title="Switch Claude account (⌘⇧A)">
      <span className="cp-dot" />
      {!isCompactViewport && <span>{current?.label ?? 'Default'}</span>}
      {fiveHour && <span className="cp-muted">{Math.round(fiveHour.usedPercent)}%</span>}
    </button>
    {open && <div className="cp-menu" role="menu" aria-label="Claude accounts" onKeyDown={onKeyDown}>
      {profiles.map((profile, index) => <button key={profile.id} ref={item => { items.current[index] = item; }}
        role="menuitemradio" aria-checked={profile.id === currentId} className="cp-item" tabIndex={-1}
        disabled={switching !== null} onClick={() => void choose(profile)}>
        <kbd>{index < 9 ? index + 1 : ''}</kbd>
        <span className="cp-name">{profile.label}{switching === profile.id && <span className="cp-muted"> switching…</span>}</span>
        <span className="cp-check">{profile.id === currentId ? '✓' : ''}</span>
        <Quota usage={quotas[profile.id]} />
      </button>)}
      {error && <p className="cp-error" role="alert">{error}</p>}
      <footer className="cp-muted"><span><kbd>1</kbd>–<kbd>{Math.min(profiles.length, 9)}</kbd> switch</span>
        <span><kbd>R</kbd> refresh</span><span><kbd>Esc</kbd> close</span></footer>
    </div>}
  </div>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'claude-profile', title: 'Claude account', component: ProfileControl });
  app.commands.register({
    id: 'open-switcher', title: 'Claude: switch account', defaultShortcut: { key: 'a', mod: true, shift: true },
    isAvailable: context => context.threadId !== null && openers.has(context.threadId),
    run: context => { if (context.threadId) openers.get(context.threadId)?.(); },
  });
});
