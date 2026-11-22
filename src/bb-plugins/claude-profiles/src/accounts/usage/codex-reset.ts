import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const trigger = z.union([z.literal('blocked'), z.number().int().min(1).max(100)]);
const arm = z.object({ mode: z.enum(['once', 'always']), trigger });
const action = z.discriminatedUnion('mode', [z.object({ mode: z.literal('off') }), arm]);
export type ResetAction = z.infer<typeof action>;
export type ResetTrigger = z.infer<typeof trigger>;
export const resetStateSchema = z.object({ mode: z.enum(['off', 'once', 'always']), trigger,
  message: z.string(), lastReset: z.string().optional(), review: z.boolean() });
export type ResetState = z.infer<typeof resetStateSchema>;
const target = z.object({ hostId: z.string().min(1) });
export const codexResetContract = defineRpcContract({
  'codexReset.status': { input: target, output: resetStateSchema },
  'codexReset.set': { input: target.extend({ action }), output: resetStateSchema },
});
export const codexResetHostContract = defineRpcContract({
  codexReset: { input: z.object({ command: z.enum(['status', 'check']) }).or(z.object({ command: z.literal('set'), action })),
    output: resetStateSchema },
});
