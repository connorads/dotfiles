import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { replySchema } from './contracts.ts';

export const rpcContract = defineRpcContract({
  claim: { input: z.object({ requestId: z.string() }), output: z.object({ claimed: z.boolean() }) },
  complete: { input: z.object({ requestId: z.string(), reply: replySchema }), output: z.object({ accepted: z.boolean() }) },
});
