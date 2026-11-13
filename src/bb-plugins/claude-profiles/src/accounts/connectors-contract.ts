import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const mode = z.enum(['account', 'off']);
const connectorState = z.object({
  enabled: z.boolean(),
  launch: z.enum(['pending', 'on', 'off', 'unknown']),
  mode,
  accounts: z.record(z.string(), z.boolean()),
  profileId: z.string(),
  // This thread's running process keeps old access until its next idle restart.
  restartPending: z.boolean(),
});
export type ConnectorState = z.infer<typeof connectorState>;
const result = z.object({ restarted: z.number() });
export const connectorsContract = defineRpcContract({
  'connectors.get': { input: z.object({ threadId: z.string().nullable() }), output: connectorState },
  'connectors.set': { input: z.object({ threadId: z.string(), mode }), output: connectorState },
  'connectors.account.set': { input: z.object({ threadId: z.string().nullable(), profileId: z.string(), enabled: z.boolean() }), output: result },
});
