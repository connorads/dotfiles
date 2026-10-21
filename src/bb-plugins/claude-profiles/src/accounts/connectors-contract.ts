import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const mode = z.enum(['account', 'off']);
const connectorState = z.object({
  enabled: z.boolean(),
  launch: z.enum(['pending', 'on', 'off', 'unknown']),
  mode,
  globalBlocked: z.boolean(),
  accounts: z.record(z.string(), z.boolean()),
  profileId: z.string(),
  pending: z.number(),
});
export type ConnectorState = z.infer<typeof connectorState>;
const result = z.object({ pending: z.number() });
export const connectorsContract = defineRpcContract({
  'connectors.get': { input: z.object({ threadId: z.string().nullable() }), output: connectorState },
  'connectors.set': { input: z.object({ threadId: z.string(), mode }), output: connectorState },
  'connectors.global.set': { input: z.object({ blocked: z.boolean() }), output: result },
  'connectors.account.set': { input: z.object({ threadId: z.string().nullable(), profileId: z.string(), enabled: z.boolean() }), output: result },
  'connectors.restart': { input: z.object({}), output: result },
});
