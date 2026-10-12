import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { replySchema } from './contracts.ts';
import { diagnosticsSchema } from './diagnostics-contract.ts';
import { archiveResultSchema, archiveTargetSchema } from './archive.ts';

export const rpcContract = defineRpcContract({
  diagnostics: { input: z.object({}), output: diagnosticsSchema },
  observed: { input: z.object({ requestId: z.string(), threadId: z.string().nullable(), title: z.string() }), output: z.object({ recorded: z.boolean() }) },
  archiveTarget: { input: z.object({ threadId: z.string() }), output: archiveTargetSchema },
  archive: { input: z.object({ target: archiveTargetSchema, confirmed: z.boolean() }), output: archiveResultSchema },
  restore: { input: z.object({}), output: archiveResultSchema },
  claim: { input: z.object({ requestId: z.string() }), output: z.object({ claimed: z.boolean() }) },
  complete: { input: z.object({ requestId: z.string(), reply: replySchema }), output: z.object({ accepted: z.boolean() }) },
});
