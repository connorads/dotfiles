import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const board = z.object({
  id: z.string(),
  closed: z.boolean(),
  members: z.array(
    z.object({
      name: z.string(),
      role: z.enum(['coordinator', 'worker']),
      run: z.enum(['working', 'idle', 'failed', 'stopped']),
      threadId: z.string(),
    }),
  ),
  entries: z.array(
    z.object({
      seq: z.number(),
      at: z.number(),
      author: z.string(),
      tone: z.enum(['post', 'relay', 'engine', 'problem']),
      text: z.string(),
    }),
  ),
});
const outcome = z.object({ ok: z.boolean(), text: z.string() });

export const changedChannel = 'swarm-changed';

export const rpcContract = defineRpcContract({
  /** The newest swarm the thread has been in, or null. */
  board: { input: z.object({ threadId: z.string() }).strict(), output: z.object({ board: board.nullable() }) },
  post: { input: z.object({ swarmId: z.string(), text: z.string() }).strict(), output: outcome },
  close: { input: z.object({ swarmId: z.string() }).strict(), output: outcome },
});
