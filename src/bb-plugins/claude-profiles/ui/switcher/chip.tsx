import { useCallback, useEffect, useState } from 'react';
import { useComposer, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { KeyedProfile, rpcContract } from '../../contracts.ts';
import type { ConnectorState } from '../../src/accounts/connectors-contract.ts';
import { open, registerAnchor, subscribeSelection } from './store.ts';
import { Glyph, useController } from './switcher.tsx';
import './switcher.css';

type Accounts = { profiles: KeyedProfile[]; currentId: string; pendingId: string | null };

/** The one composer control: what the next turn runs on. It opens the switcher. */
export function Chip() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const controller = useController(composer);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [daybreak, setDaybreak] = useState<boolean | undefined>();
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [connectors, setConnectors] = useState<Pick<ConnectorState, 'enabled' | 'launch'> | null>(null);
  const providerId = composer.selection?.providerId;
  const model = composer.selection?.model;
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  useEffect(() => {
    if (!providerId) return;
    let alive = true;
    Promise.all([controller.models(providerId), controller.daybreak()]).then(
      ([models, programme]) => { if (alive) { setNames(new Map(models.map(m => [m.model, m.displayName]))); setDaybreak(programme); } },
      () => { if (alive) setNames(new Map()); });
    return () => { alive = false; };
  }, [controller, providerId, model, composer.isRunning]);
  useEffect(() => subscribeSelection(key => {
    if (key === composer.key) void controller.daybreak().then(setDaybreak, () => setDaybreak(undefined));
  }), [composer.key, controller]);
  const loadAccounts = useCallback(() => {
    if (providerId !== 'claude-code' || (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread')) { setAccounts(null); setConnectors(null); return; }
    rpc.call('accounts', { threadId }).then(value => setAccounts(value.supported ? value : null), () => setAccounts(null));
    rpc.call('connectors.get', { threadId }).then(setConnectors, () => setConnectors(null));
  }, [rpc, threadId, providerId, composer.scope.kind]);
  // A thread gains its environment during the first turn, so reload when a turn ends.
  useEffect(loadAccounts, [loadAccounts, composer.isRunning]);
  useRealtime('profiles-changed', loadAccounts);
  if (!providerId || !model) return null;
  const name = `${names.get(model) ?? model}${daybreak ? ' · Daybreak' : ''}`;
  const effort = composer.selection?.reasoningLevel;
  const fast = composer.selection?.serviceTier && composer.selection.serviceTier !== 'default';
  const shownId = accounts?.pendingId ?? accounts?.currentId;
  const account = accounts && accounts.profiles.length > 1 ? accounts.profiles.find(profile => profile.id === shownId) : undefined;
  const stillOn = connectors && !connectors.enabled && connectors.launch === 'on';
  return <button type="button" className="sw-chip" ref={element => registerAnchor(composer.key, element)} onClick={() => open(composer)}
    aria-label={`Switch model: ${name}${effort ? `, ${effort}` : ''}${account ? `, ${account.label} account` : ''}`} title="Switch model (⌘⇧M)">
    <Glyph providerId={providerId} />
    <span>{name}</span>
    {(effort || fast) && <span className="sw-muted">{[effort, fast ? 'fast' : null].filter(Boolean).join(' · ')}</span>}
    {account && <><span className="sw-sep" aria-hidden="true" />
      <span className="sw-key" aria-hidden="true">{account.key ?? '?'}</span>
      <span className="sw-muted">{account.label}{accounts?.pendingId ? ' · next turn' : ''}</span></>}
    {stillOn && <span className="sw-warn">connectors still on</span>}
  </button>;
}
