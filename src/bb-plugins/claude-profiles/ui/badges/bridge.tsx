import { useCallback, useEffect } from 'react';
import { useRealtime, useRpc, useSdk } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import { setBadges } from './store.ts';
import { setWorkflowLoader, workflowViewSchema } from './workflows.ts';

// Mounted as an always-present overlay because content scripts cannot call the plugin's RPC.
export function BadgeBridge() {
  const sdk = useSdk();
  useEffect(() => {
    setWorkflowLoader(async (threadId, runId, signal) => {
      const { run } = await sdk.plugins.callRpc({ pluginId: 'workflows', method: 'workflowRunView',
        input: { threadId, runId }, outputSchema: workflowViewSchema, signal });
      return run ? [...run.phases.flatMap(phase => phase.calls), ...run.unphasedCalls] : [];
    });
    return () => setWorkflowLoader(null);
  }, [sdk]);
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => {
    rpc.call('threadAccounts', {}).then(setBadges, () => {});
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime('profiles-changed', load);
  return null;
}
