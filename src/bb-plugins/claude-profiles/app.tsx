import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { definePluginApp, useComposer, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import type { rpcContract, Profile } from './contracts.ts';
import './app.css';
import { command, CommandOwner, Overlay, Trigger } from './ui/picker/picker.tsx';
import { open as openPicker } from './ui/picker/store.ts';

const popupId = 'accounts';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Profile request failed.';
const threadOf = (composer: PluginComposerApi) => composer.scope.kind === 'thread' ? composer.scope.threadId : null;
// The new-thread composer can switch provider, so the picker shows only while Claude Code is selected.
const isClaude = (composer: PluginComposerApi) => composer.scope.kind === 'thread' || composer.selection?.providerId === 'claude-code';

function useAccounts(composer: PluginComposerApi) {
  const rpc = useRpc<typeof rpcContract>();
  const threadId = threadOf(composer);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState('default');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call('accounts', { threadId }).then(value => {
      setProfiles(value.supported ? value.profiles : []); setCurrentId(value.currentId);
    }, cause => setError(message(cause)));
  }, [rpc, threadId]);
  // A thread gains its environment during the first turn, so reload when a turn ends.
  useEffect(load, [load, composer.isRunning]);
  useRealtime('profiles-changed', load);
  const choose = useCallback(async (profileId: string) => {
    setError(null);
    const value = await rpc.call('choose', { threadId, profileId });
    setCurrentId(value.currentId);
  }, [rpc, threadId]);
  return { profiles, currentId, error, setError, choose };
}

function AccountButton() {
  const composer = useComposer();
  const { profiles, currentId } = useAccounts(composer);
  if (!isClaude(composer) || !profiles.length) return null;
  const label = profiles.find(profile => profile.id === currentId)?.label ?? 'Default';
  return <button type="button" className="cp-trigger" disabled={composer.isRunning}
    onClick={() => composer.experimental_openPopup(popupId)} aria-haspopup="menu"
    aria-label={`Claude account ${label}`} title={composer.isRunning ? 'Finish the turn to switch account' : 'Switch Claude account'}>
    <span className="cp-dot" />
    {composer.layout === 'expanded' && <span>{label}</span>}
  </button>;
}

function AccountMenu() {
  const composer = useComposer();
  const { profiles, currentId, error, setError, choose } = useAccounts(composer);
  const [switching, setSwitching] = useState<string | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const isThread = threadOf(composer) !== null;
  useEffect(() => {
    items.current[Math.max(0, profiles.findIndex(profile => profile.id === currentId))]?.focus();
  }, [profiles.length]);

  async function pick(profile: Profile) {
    if (switching) return;
    if (profile.id === currentId) { composer.experimental_closePopup(); return; }
    setSwitching(profile.id);
    try { await choose(profile.id); composer.experimental_closePopup(); }
    catch (cause) { setError(message(cause)); }
    finally { setSwitching(null); }
  }
  function onKeyDown(event: KeyboardEvent) {
    const focused = items.current.findIndex(item => item === document.activeElement);
    const focus = (index: number) => items.current[(index + profiles.length) % profiles.length]?.focus();
    const digit = Number(event.key);
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.nativeEvent.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape' || event.key === 'q' || event.key === 'Q') composer.experimental_closePopup();
    else if (event.key === 'ArrowDown') focus(focused + 1);
    else if (event.key === 'ArrowUp') focus(focused - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(-1);
    else if ((event.key === 'Enter' || event.key === ' ') && profiles[focused]) void pick(profiles[focused]);
    else if (Number.isInteger(digit) && profiles[digit - 1]) void pick(profiles[digit - 1]);
    else return;
    event.preventDefault(); event.stopPropagation();
  }

  return <div className="claude-profiles cp-menu" role="menu" aria-label="Claude accounts" onKeyDown={onKeyDown}>
    {profiles.map((profile, index) => <button key={profile.id} ref={item => { items.current[index] = item; }}
      role="menuitemradio" aria-checked={profile.id === currentId} className="cp-item" tabIndex={-1}
      disabled={switching !== null} onClick={() => void pick(profile)}>
      <kbd>{index < 9 ? index + 1 : ''}</kbd>
      <span className="cp-name">{profile.label}{switching === profile.id && <span className="cp-muted"> switching…</span>}</span>
      <span className="cp-check">{profile.id === currentId ? '✓' : ''}</span>
    </button>)}
    {error && <p className="cp-error" role="alert">{error}</p>}
    <p className="cp-note cp-muted">{isThread
      ? 'The next message continues this conversation on the chosen account.'
      : 'New Claude threads start on this account.'}</p>
    <footer className="cp-muted"><span><kbd>1</kbd>-<kbd>{Math.min(profiles.length, 9)}</kbd> switch</span>
      <span><kbd>Q / Esc</kbd> close</span></footer>
  </div>;
}

export default definePluginApp(app => {
  app.composer.customize({
    id: 'claude-account', scopes: ['thread', 'new-thread'],
    actions: [{ id: 'claude-account', component: AccountButton }],
    experimental_popups: [{ id: popupId, label: 'Claude accounts', component: AccountMenu }],
  });
  app.composer.experimental_registerCommand({ id: 'open-switcher', title: 'Claude: switch account',
    run: ({ composer }) => { if (isClaude(composer)) composer.experimental_openPopup(popupId); } });
  app.slots.experimental_appOverlay({ id: 'picker', component: Overlay });
  app.composer.customize({ id: 'agent-switcher', scopes: ['thread', 'new-thread'],
    banners: [{ id: 'command-owner', chrome: 'bare', component: CommandOwner }],
    actions: [{ id: 'picker', component: Trigger }],
    plusMenu: [{ id: 'picker', label: 'Switch model', icon: 'Star', run: ({ composer }) => openPicker(composer) }],
  });
  app.composer.experimental_registerCommand({ id: 'open-picker', title: 'Agent Switcher: open picker',
    defaultShortcut: { key: 'f', alt: true }, run: ({ composer }) => openPicker(composer) });
  app.composer.experimental_registerCommand({ id: 'next-favourite', title: 'Agent Switcher: next favourite',
    defaultShortcut: { key: 'f', alt: true, shift: true }, run: ({ composer }) => command(composer, controller => controller.cycle(1)) });
  app.composer.experimental_registerCommand({ id: 'previous-favourite', title: 'Agent Switcher: previous favourite',
    run: ({ composer }) => command(composer, controller => controller.cycle(-1)) });
  for (let slot = 1; slot <= 9; slot++) app.composer.experimental_registerCommand({ id: `select-favourite-${slot}`,
    title: `Agent Switcher: select favourite ${slot}`, run: ({ composer }) => command(composer, controller => controller.select(slot)) });
});
