import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const repositorySchema = z.object({
  fullName: z.string(), description: z.string(), visibility: z.string(),
});
export type Repository = z.infer<typeof repositorySchema>;
const repository = z.string().trim().min(1).max(300);
const destination = z.string().trim().min(1).max(4096);
const page = z.number().int().min(1).max(1000);
const failure = z.object({ ok: z.literal(false), message: z.string() });
const listing = z.discriminatedUnion('ok', [
  failure,
  z.object({ ok: z.literal(true), repositories: z.array(repositorySchema), hasMore: z.boolean() }),
]);
const preparation = z.discriminatedUnion('ok', [
  failure,
  z.object({ ok: z.literal(true), path: z.string(), reused: z.boolean() }),
]);
export const hostContract = defineRpcContract({
  info: { input: z.object({}), output: z.object({ defaultRoot: z.string(), platform: z.string() }) },
  list: { input: z.object({ page }), output: listing },
  prepare: { input: z.object({ repository, destination }), output: preparation },
});
const existing = z.object({ repository: z.string(), projectId: z.string(), path: z.string() });
export const rpcContract = defineRpcContract({
  init: {
    input: z.object({}),
    output: z.object({ defaultRoot: z.string(), existing: z.array(existing) }),
  },
  list: { input: z.object({ page }), output: listing },
  open: {
    input: z.object({ repository, destination }),
    output: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), projectId: z.string(), path: z.string() }),
      z.object({ ok: z.literal(false), stage: z.enum(['clone', 'register']), message: z.string(), path: z.string().optional() }),
    ]),
  },
});
