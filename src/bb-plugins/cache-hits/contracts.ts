import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { cacheStateSchema } from './src/cache.ts';
import { transcriptItemSchema } from './src/transcript.ts';

export const hostContract = defineRpcContract({
  transcript: {
    input: z.object({ configDir: z.string().nullable(), sessionId: z.string().regex(/^[\w-]+$/), offset: z.number().int().nonnegative() }),
    output: z.object({ offset: z.number(), items: z.array(transcriptItemSchema) }),
  },
});
export const rpcContract = defineRpcContract({
  thread: { input: z.object({ threadId: z.string() }), output: cacheStateSchema.nullable() },
});
