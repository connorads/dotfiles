import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const hostContract = defineRpcContract({
  homeDir: { input: z.object({}), output: z.string().startsWith('/') },
});
export const rpcContract = defineRpcContract({
  homeDir: { input: z.object({ hostId: z.string().min(1) }), output: z.string().startsWith('/') },
});
