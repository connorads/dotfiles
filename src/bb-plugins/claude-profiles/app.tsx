import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract, Profile, Selection } from './contracts.ts';
import './app.css';

// The command runs outside React, so each mounted header registers how to open its own menu.
const openers = new Map<string, () => void>();
function ProfileControl({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  useEffect(() => { setOpen(false); load(); }, [load]);
  useRealtime('profiles-changed', load);

  const openMenu = useCallback(() => {
    setError(null); setOpen(true);
  }, []);
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
    else if (Number.isInteger(digit) && profiles[digit - 1]) void choose(profiles[digit - 1]);
    else return;
    event.preventDefault(); event.stopPropagation();
  }

  if (!profiles.length) return null;
  return <div className="claude-profiles" ref={root}>
    <button ref={trigger} className="cp-trigger" onClick={() => open ? close() : openMenu()} aria-haspopup="menu"
      aria-expanded={open} aria-label={`Claude account ${current?.label ?? 'Default'}`} title="Switch Claude account">
      <span className="cp-dot" />
      {!isCompactViewport && <span>{current?.label ?? 'Default'}</span>}
    </button>
    {open && <div className="cp-menu" role="menu" aria-label="Claude accounts" onKeyDown={onKeyDown}>
      {profiles.map((profile, index) => <button key={profile.id} ref={item => { items.current[index] = item; }}
        role="menuitemradio" aria-checked={profile.id === currentId} className="cp-item" tabIndex={-1}
        disabled={switching !== null} onClick={() => void choose(profile)}>
        <kbd>{index < 9 ? index + 1 : ''}</kbd>
        <span className="cp-name">{profile.label}{switching === profile.id && <span className="cp-muted"> switching…</span>}</span>
        <span className="cp-check">{profile.id === currentId ? '✓' : ''}</span>
      </button>)}
      {error && <p className="cp-error" role="alert">{error}</p>}
      <p className="cp-note cp-muted">Finish or stop the turn and clear queued messages before switching.</p>
      <footer className="cp-muted"><span><kbd>1</kbd>-<kbd>{Math.min(profiles.length, 9)}</kbd> switch</span>
        <span><kbd>Esc</kbd> close</span></footer>
    </div>}
  </div>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'claude-profile', title: 'Claude account', component: ProfileControl });
  app.commands.register({
    id: 'open-switcher', title: 'Claude: switch account',
    isAvailable: context => context.threadId !== null && openers.has(context.threadId),
    run: context => { if (context.threadId) openers.get(context.threadId)?.(); },
  });
});
