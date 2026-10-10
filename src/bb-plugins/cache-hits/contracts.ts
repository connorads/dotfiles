import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { cacheStateSchema } from './src/cache.ts';

export const rpcContract = defineRpcContract({
  thread: { input: z.object({ threadId: z.string() }), output: cacheStateSchema.nullable() },
});
