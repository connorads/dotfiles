import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { replySchema } from './contracts.ts';
import { archiveResultSchema, archiveTargetSchema } from './archive.ts';

export const rpcContract = defineRpcContract({
  archiveTarget: { input: z.object({ threadId: z.string() }), output: archiveTargetSchema },
  archive: { input: z.object({ target: archiveTargetSchema, confirmed: z.boolean() }), output: archiveResultSchema },
  restore: { input: z.object({}), output: archiveResultSchema },
  claim: { input: z.object({ requestId: z.string() }), output: z.object({ claimed: z.boolean() }) },
  complete: { input: z.object({ requestId: z.string(), reply: replySchema }), output: z.object({ accepted: z.boolean() }) },
});
