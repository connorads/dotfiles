import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { nativeResult, threadKey } from './native-contract';

export const ownerResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), hostId: z.string(), text: z.string() }),
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
]);
export type OwnerResult = z.infer<typeof ownerResult>;
export const rpcContract = defineRpcContract({
  owner: { input: z.object({ threadId: z.string().min(1) }).strict(), output: ownerResult },
  native: { input: z.object({ threadId: threadKey, collect: z.boolean() }).strict(), output: z.object({ providerId: z.string().nullable(), tracingEnabled: z.boolean(), report: nativeResult }) },
  tracing: { input: z.object({ threadId: threadKey, enabled: z.boolean() }).strict(), output: z.object({ enabled: z.boolean() }) },
  purge: { input: z.object({ threadId: threadKey }).strict(), output: z.object({ purged: z.boolean() }) },
});
