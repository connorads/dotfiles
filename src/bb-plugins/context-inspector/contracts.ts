import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const ownerResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), hostId: z.string(), text: z.string() }),
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
]);
export type OwnerResult = z.infer<typeof ownerResult>;
export const rpcContract = defineRpcContract({
  owner: { input: z.object({ threadId: z.string().min(1) }).strict(), output: ownerResult },
});
