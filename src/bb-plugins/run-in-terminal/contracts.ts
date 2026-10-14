import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const rpcContract = defineRpcContract({
  paste: {
    input: z.object({ threadId: z.string().min(1), text: z.string().min(1) }),
    output: z.object({ terminalId: z.string().min(1) }),
  },
});
