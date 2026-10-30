import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const rpcContract = defineRpcContract({
  open: {
    input: z.object({ threadId: z.string().min(1), cwd: z.string().min(1).optional() }),
    output: z.object({ terminalId: z.string().min(1) }),
  },
});
