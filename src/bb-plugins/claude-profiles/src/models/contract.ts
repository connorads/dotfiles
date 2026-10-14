import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const effortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']);
export type Effort = z.infer<typeof effortSchema>;
export const setupSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(300),
  reasoningLevel: effortSchema.optional(),
  serviceTier: z.string().trim().min(1).max(80).optional(),
}).strict();
export const nameSchema = z.string().trim().max(60);
export const favouriteSchema = setupSchema.extend({ name: nameSchema, id: z.string().min(1), slot: z.number().int().min(1).max(9) });
export const listSchema = z.array(favouriteSchema).max(9).refine(
  list => new Set(list.map(f => f.id)).size === list.length && new Set(list.map(f => f.slot)).size === list.length,
  'Favourite IDs and shortcut slots must be unique',
).refine(
  list => new Set(list.map(f => JSON.stringify([f.providerId, f.model]))).size === list.length,
  'A model can be a favourite only once',
);
export type Setup = z.infer<typeof setupSchema>;
export type Favourite = z.infer<typeof favouriteSchema>;
export const addSchema = setupSchema.omit({ serviceTier: true }).extend({ name: nameSchema }).strict();
export type FavouriteInput = z.infer<typeof addSchema>;

export const modelsContract = defineRpcContract({
  'favourites.list': { input: z.object({}).strict(), output: listSchema },
  'favourites.add': { input: addSchema, output: listSchema },
  'favourites.remove': { input: z.object({ id: z.string() }).strict(), output: listSchema },
  'favourites.setEffort': { input: z.object({ id: z.string(), reasoningLevel: effortSchema.nullable() }).strict(), output: listSchema },
});
