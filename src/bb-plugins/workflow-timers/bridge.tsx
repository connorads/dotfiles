import { useEffect } from 'react';
import { useSdk } from '@get-bb/plugin-sdk/app';
import { setSource, workflowViewSchema } from './timers';

// Content scripts cannot call the SDK, so this null overlay supplies run views and thread events.
export function TimerBridge() {
  const sdk = useSdk();
  useEffect(() => {
    setSource({
      calls: async (threadId, runId, signal) => {
        const { run } = await sdk.plugins.callRpc({ pluginId: 'workflows', method: 'workflowRunView',
          input: { threadId, runId }, outputSchema: workflowViewSchema, signal });
        return run ? [...run.phases.flatMap(phase => phase.calls), ...run.unphasedCalls] : [];
      },
      // The run view's activity time only changes at call boundaries; worker thread events change throughout.
      lastActivity: async (threadId, signal) => {
        const [latest] = await sdk.threads.events.list({ threadId, order: 'desc', limit: '1', signal });
        return latest?.createdAt ?? null;
      },
    });
    return () => setSource(null);
  }, [sdk]);
  return null;
}
