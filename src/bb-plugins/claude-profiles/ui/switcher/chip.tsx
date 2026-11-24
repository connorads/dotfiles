import { useCallback, useEffect, useState } from 'react';
import { useComposer, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { KeyedProfile, rpcContract } from '../../contracts.ts';
import type { ConnectorState } from '../../src/accounts/connectors-contract.ts';
import { open, registerAnchor, subscribeSelection } from './store.ts';
import { Glyph, useController } from './switcher.tsx';
import { tierLabel, type CatalogModel } from './view.ts';
import './switcher.css';
import { antigravityAccountId } from '../../src/accounts/antigravity-account.ts';

type Accounts = { profiles: KeyedProfile[]; currentId: string; pendingId: string | null };

/** The one composer control: what the next turn runs on. It opens the switcher. */
export function Chip() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const controller = useController(composer);
  const [models, setModels] = useState<CatalogModel[]>([]);
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
      ([models, programme]) => { if (alive) { setModels(models); setDaybreak(programme); } },
      () => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [controller, providerId, model, composer.isRunning]);
  useEffect(() => subscribeSelection(key => {
    if (key === composer.key) void controller.daybreak().then(setDaybreak, () => setDaybreak(undefined));
  }), [composer.key, controller]);
  const loadAccounts = useCallback(() => {
    if (providerId && antigravityAccountId(providerId) !== null) {
      setConnectors(null);
      controller.hostId().then(hostId => rpc.call('antigravityAccounts', { hostId }))
        .then(profiles => setAccounts({ profiles, currentId: providerId, pendingId: null }), () => setAccounts(null));
      return;
    }
    if (providerId !== 'claude-code' || (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread')) { setAccounts(null); setConnectors(null); return; }
    rpc.call('accounts', { threadId }).then(value => setAccounts(value.supported ? value : null), () => setAccounts(null));
    rpc.call('connectors.get', { threadId }).then(setConnectors, () => setConnectors(null));
  }, [rpc, threadId, providerId, composer.scope.kind, controller]);
  // A thread gains its environment during the first turn, so reload when a turn ends.
  useEffect(loadAccounts, [loadAccounts, composer.isRunning]);
  useRealtime('profiles-changed', loadAccounts);
  if (!providerId || !model) return null;
  const currentModel = models.find(entry => entry.model === model);
  const name = `${currentModel?.displayName ?? model}${daybreak ? ' · Daybreak' : ''}`;
  const effort = composer.selection?.reasoningLevel;
  const tier = composer.selection?.serviceTier;
  const speed = tier && tier !== 'default' ? tierLabel(tier, currentModel) : null;
  const shownId = accounts?.pendingId ?? accounts?.currentId;
  const account = accounts && accounts.profiles.length > 1 ? accounts.profiles.find(profile => profile.id === shownId) : undefined;
  const missingId = accounts && shownId && shownId !== 'default' && !accounts.profiles.some(profile => profile.id === shownId) ? shownId : null;
  const pending = Boolean(accounts?.pendingId);
  const stillOn = connectors && !connectors.enabled && connectors.launch === 'on';
  return <button type="button" className="sw-chip" ref={element => registerAnchor(composer.key, element)} onClick={() => open(composer)}
    aria-label={`Switch model: ${name}${effort ? `, ${effort}` : ''}${speed ? `, ${speed}` : ''}${account ? `, ${account.label} account${pending ? ' from the next turn' : ''}` : missingId ? `, ${missingId} account (missing)` : ''}${stillOn ? ', connectors still on' : ''}`}
    title="Switch model (⌘⇧M)">
    <Glyph providerId={providerId} />
    <span className="sw-chip-name">{name}</span>
    {(effort || speed) && <span className="sw-muted">{[effort, speed].filter(Boolean).join(' · ')}</span>}
    {account && <><span className="sw-sep" aria-hidden="true" />
      <span className="sw-key" aria-hidden="true">{account.key ?? '?'}</span>
      <span className="sw-muted sw-chip-account">{account.label}</span>
      {pending && <span className="sw-muted sw-chip-next">· next turn</span>}</>}
    {missingId && <><span className="sw-sep" aria-hidden="true" />
      <span className="sw-warn" title="Account removed on this machine">{missingId} (missing)</span></>}
    {stillOn && <span className="sw-warn" title="Connectors still on">connectors still on</span>}
  </button>;
}
