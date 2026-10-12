import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { usageSchema } from './src/usage.ts';
import { measurementSchema, resourceSchema } from './src/usage-source.ts';

export const profileSchema = z.object({ id: z.string(), label: z.string(), configDir: z.string().nullable() });
export type Profile = z.infer<typeof profileSchema>;
export const selectionSchema = z.object({ hostId: z.string(), profile: profileSchema });
export type Selection = z.infer<typeof selectionSchema>;
const rootInput = { root: z.string() };
export const hostContract = defineRpcContract({
  profiles: { input: z.object(rootInput), output: z.array(profileSchema) },
  validate: { input: z.object({ ...rootInput, profileId: z.string(), executable: z.string() }), output: z.object({ authenticated: z.literal(true) }) },
  usage: { input: z.object({ ...rootInput, profileId: z.string(), executable: z.string() }), output: usageSchema },
  transfer: { input: z.object({ ...rootInput, sourceDir: z.string().nullable(), profileId: z.string(), sessionId: z.string() }), output: z.object({ copied: z.boolean() }) },
});
// A null thread is the new-thread composer: its choice is remembered and claimed by the next Claude thread's first send.
export const rpcContract = defineRpcContract({
  accounts: { input: z.object({ threadId: z.string().nullable() }), output: z.object({
    supported: z.boolean(), profiles: z.array(profileSchema), currentId: z.string(),
  }) },
  choose: { input: z.object({ threadId: z.string().nullable(), profileId: z.string() }), output: z.object({ currentId: z.string() }) },
  usage: { input: z.object({ threadId: z.string(), profileId: z.string(), refresh: z.boolean() }), output: usageSchema },
});
export const usageSourceContract = defineRpcContract({
  'provider-usage.v1.listResources': {
    input: z.object({}), output: z.object({ resources: z.array(resourceSchema) }),
    experimental_description: 'List Claude profile quota resources on BB hosts. Reads directory metadata only; does not request quota.',
  },
  'provider-usage.v1.getResource': {
    input: z.object({ resourceId: z.string(), refresh: z.boolean() }), output: measurementSchema,
    experimental_description: 'Read one profile quota through the native Claude CLI. Refresh bypasses the one-minute cache.',
  },
});
