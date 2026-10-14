import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const rpcContract = defineRpcContract({
  open: {
    input: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('thread'), threadId: z.string().min(1) }),
      z.object({ kind: z.literal('environment'), environmentId: z.string().min(1) }),
      z.object({ kind: z.literal('project'), projectId: z.string().min(1) }),
    ]),
    output: z.object({ terminalId: z.string().min(1) }),
  },
});
