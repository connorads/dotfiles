import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const connectorState = z.object({
  enabled: z.boolean(),
  launch: z.enum(['pending', 'on', 'off', 'unknown']),
});
export type ConnectorState = z.infer<typeof connectorState>;
export const connectorsContract = defineRpcContract({
  'connectors.get': { input: z.object({ threadId: z.string().nullable() }), output: connectorState },
  'connectors.set': { input: z.object({ threadId: z.string(), enabled: z.boolean() }), output: connectorState },
});
