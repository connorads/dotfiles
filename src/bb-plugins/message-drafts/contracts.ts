import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const draftSchema = z.object({ text: z.string().max(16000), revision: z.number().int().nonnegative() });
export type Draft = z.infer<typeof draftSchema>;
export const writeSchema = z.object({ text: z.string().max(16000), revision: z.number().int().nonnegative() });
export const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), revision: z.number().int() }),
  z.object({ ok: z.literal(false), revision: z.number().int(), error: z.literal('Draft changed. Read it before writing again.') }),
]);
export const rpcContract = defineRpcContract({
  read: { input: z.object({ threadId: z.string().min(1) }), output: draftSchema },
  write: { input: writeSchema.extend({ threadId: z.string().min(1) }), output: resultSchema },
});
