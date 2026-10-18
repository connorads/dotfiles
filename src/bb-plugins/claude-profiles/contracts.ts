import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { usageSchema } from './src/accounts/quota.ts';
import { measurementSchema, resourceSchema } from './src/accounts/usage-source.ts';
import { usageContract, usageHostContract } from './src/accounts/usage/contract.ts';
import { ampReadingSchema } from './src/accounts/usage/amp-reading.ts';
import { modelsContract } from './src/models/contract.ts';

export const profileSchema = z.object({ id: z.string(), label: z.string(), configDir: z.string().nullable() });
export type Profile = z.infer<typeof profileSchema>;
export const selectionSchema = z.object({ hostId: z.string(), profile: profileSchema });
export type Selection = z.infer<typeof selectionSchema>;
export const threadAccountSchema = z.object({ threadId: z.string(), profileId: z.string(), label: z.string() });
export type ThreadAccount = z.infer<typeof threadAccountSchema>;
const rootInput = { root: z.string() };
export const hostContract = defineRpcContract({
  profiles: { input: z.object(rootInput), output: z.array(profileSchema) },
  validate: { input: z.object({ ...rootInput, profileId: z.string(), executable: z.string() }), output: z.object({ authenticated: z.literal(true) }) },
  usage: { input: z.object({ ...rootInput, profileId: z.string(), executable: z.string() }), output: usageSchema },
  transfer: { input: z.object({ ...rootInput, sourceDir: z.string().nullable(), profileId: z.string(), sessionId: z.string() }), output: z.object({ copied: z.boolean() }) },
  // A ref is a native session ID or a tmux pane target.
  locate: { input: z.object({ ...rootInput, ref: z.string() }),
    output: z.object({ profileId: z.string(), sessionId: z.string(), cwd: z.string(), title: z.string() }) },
  adopt: { input: z.object({ ...rootInput, profileId: z.string(), sourceSessionId: z.string(), sessionId: z.string() }),
    output: z.object({ adopted: z.literal(true) }) },
  ampUsage: { input: z.object({}), output: ampReadingSchema },
  grokUsage: { input: z.object({}), output: measurementSchema },
  ...usageHostContract,
});
// A null thread is the new-thread composer: its choice is remembered and claimed by the next Claude thread's first send.
export const accountsContract = defineRpcContract({
  accounts: { input: z.object({ threadId: z.string().nullable() }), output: z.object({
    supported: z.boolean(), profiles: z.array(profileSchema), currentId: z.string(),
  }) },
  choose: { input: z.object({ threadId: z.string().nullable(), profileId: z.string() }), output: z.object({ currentId: z.string() }) },
  usage: { input: z.object({ threadId: z.string(), profileId: z.string(), refresh: z.boolean() }), output: usageSchema },
  // A draft has no thread yet, so its quota is read on the machine that lists its accounts.
  nextThreadQuota: { input: z.object({ profileId: z.string() }), output: usageSchema },
  // Threads on Default are omitted: the sidebar badges only named accounts.
  threadAccounts: { input: z.object({}), output: z.array(threadAccountSchema) },
});
export const rpcContract = defineRpcContract({ ...accountsContract, ...modelsContract, ...usageContract });
export const usageSourceContract = defineRpcContract({
  'provider-usage.v1.listResources': {
    input: z.object({}), output: z.object({ resources: z.array(resourceSchema) }),
    experimental_description: 'List profile and Grok quota resources on BB hosts without requesting quota.',
  },
  'provider-usage.v1.getResource': {
    input: z.object({ resourceId: z.string(), refresh: z.boolean() }), output: measurementSchema,
    experimental_description: 'Read one quota resource through its native CLI. Refresh bypasses the one-minute cache.',
  },
});
