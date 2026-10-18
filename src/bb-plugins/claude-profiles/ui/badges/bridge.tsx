import { useCallback, useEffect } from 'react';
import { useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import { setBadges } from './store.ts';

// Mounted as an always-present overlay because content scripts cannot call the plugin's RPC.
export function BadgeBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => {
    rpc.call('threadAccounts', {}).then(setBadges, () => {});
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime('profiles-changed', load);
  return null;
}
