import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const setupSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(300),
  reasoningLevel: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']).optional(),
  serviceTier: z.string().trim().min(1).max(80).optional(),
}).strict();
export const nameSchema = z.string().trim().max(60);
const inputSchema = setupSchema.extend({ name: nameSchema });
export const favouriteSchema = inputSchema.extend({ id: z.string().min(1), slot: z.number().int().min(1).max(9) });
export const listSchema = z.array(favouriteSchema).max(9).refine(
  list => new Set(list.map(f => f.id)).size === list.length && new Set(list.map(f => f.slot)).size === list.length,
  'Favourite IDs and shortcut slots must be unique',
);
export type Setup = z.infer<typeof setupSchema>;
export type Favourite = z.infer<typeof favouriteSchema>;
export type FavouriteInput = z.infer<typeof inputSchema>;
export const rpcContract = defineRpcContract({
  list: { input: z.object({}).strict(), output: listSchema },
  add: { input: inputSchema, output: listSchema },
  rename: { input: z.object({ id: z.string(), name: nameSchema }).strict(), output: listSchema },
  remove: { input: z.object({ id: z.string() }).strict(), output: listSchema },
  move: { input: z.object({ id: z.string(), direction: z.union([z.literal(-1), z.literal(1)]) }).strict(), output: listSchema },
});
