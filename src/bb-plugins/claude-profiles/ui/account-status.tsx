import { useCallback, useEffect, useState } from 'react';
import { useComposer, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import type { rpcContract, Profile } from '../contracts.ts';
import { open } from './picker/store.ts';
import './account-status.css';

// The new-thread composer can switch provider, so the status shows only while Claude Code is selected.
export const isClaude = (composer: PluginComposerApi) => (composer.scope.kind === 'thread' || composer.scope.kind === 'new-thread')
  && composer.selection?.providerId === 'claude-code';

export const accountUnavailable = 'Account selection is unavailable in this draft. New Claude threads use your remembered account. You can switch after the first message.';

export function openAccount(composer: PluginComposerApi) { if (isClaude(composer)) open(composer, { focus: 'account' }); }

export function AccountStatus() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState('default');
  const claude = isClaude(composer);
  const load = useCallback(() => {
    if (!claude) { setProfiles([]); return; }
    rpc.call('accounts', { threadId }).then(value => {
      setProfiles(value.supported ? value.profiles : []); setCurrentId(value.currentId);
    }, () => setProfiles([]));
  }, [rpc, threadId, claude]);
  // A thread gains its environment during the first turn, so reload when a turn ends.
  useEffect(load, [load, composer.isRunning]);
  useRealtime('profiles-changed', load);
  if (!isClaude(composer) || !profiles.length) return null;
  const label = profiles.find(profile => profile.id === currentId)?.label ?? 'Default';
  return <button type="button" className="cp-trigger" onClick={() => openAccount(composer)}
    aria-label={`Claude account ${label}`} title="Switch Claude account (Alt+A)">
    <span className="cp-dot" />
    <span>{label}</span>
  </button>;
}
