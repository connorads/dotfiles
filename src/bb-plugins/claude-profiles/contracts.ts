import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { usageSchema } from './src/accounts/quota.ts';
import { measurementSchema, resourceSchema } from './src/accounts/usage-source.ts';
import { usageContract, usageHostContract } from './src/accounts/usage/contract.ts';
import { ampReadingSchema } from './src/accounts/usage/amp-reading.ts';
import { modelsContract } from './src/models/contract.ts';
import { connectorsContract } from './src/accounts/connectors-contract.ts';

export const profileSchema = z.object({ id: z.string(), label: z.string(), configDir: z.string().nullable() });
export type Profile = z.infer<typeof profileSchema>;
export const selectionSchema = z.object({ hostId: z.string(), profile: profileSchema });
export type Selection = z.infer<typeof selectionSchema>;
export const threadAccountSchema = z.object({ threadId: z.string(), profileId: z.string(), label: z.string(), key: z.string().nullable() });
// A keyed profile carries its stable picker and badge letter.
export const keyedProfileSchema = profileSchema.extend({ key: z.string().nullable() });
export type KeyedProfile = z.infer<typeof keyedProfileSchema>;
export type ThreadAccount = z.infer<typeof threadAccountSchema>;
const rootInput = { root: z.string() };
export const copySummarySchema = z.object({ prompts: z.number(), modifiedAt: z.string(), lastPrompt: z.string().nullable() });
export type CopySummary = z.infer<typeof copySummarySchema>;
/** The target account holds a copy of this thread's session with history this thread lacks. */
export const historyConflictSchema = z.object({ profileId: z.string(), label: z.string(), source: copySummarySchema, target: copySummarySchema });
export type HistoryConflict = z.infer<typeof historyConflictSchema>;
export const hostContract = defineRpcContract({
  profiles: { input: z.object(rootInput), output: z.array(profileSchema) },
  validate: { input: z.object({ ...rootInput, profileId: z.string(), executable: z.string() }), output: z.object({ authenticated: z.literal(true) }) },
  usage: { input: z.object({ ...rootInput, profileId: z.string(), executable: z.string() }), output: usageSchema },
  // Derives a profile's shared settings, memory, skills and commands from ~/.claude before Claude launches on it.
  materialise: { input: z.object({ ...rootInput, profileId: z.string() }), output: z.object({ materialised: z.boolean() }) },
  transfer: { input: z.object({ ...rootInput, sourceDir: z.string().nullable(), profileId: z.string(), sessionId: z.string(), replace: z.boolean(),
    allowMissing: z.boolean().optional() }),
    output: z.discriminatedUnion('status', [z.object({ status: z.literal('copied') }),
      z.object({ status: z.literal('diverged'), source: copySummarySchema, target: copySummarySchema })]) },
  release: { input: z.object({ ...rootInput, sourceDir: z.string().nullable(), profileId: z.string(), sessionId: z.string() }), output: z.object({ released: z.boolean() }) },
  // A ref is a native session ID or a tmux pane target.
  locate: { input: z.object({ ...rootInput, ref: z.string() }),
    output: z.object({ profileId: z.string(), sessionId: z.string(), cwd: z.string(), title: z.string() }) },
  adopt: { input: z.object({ ...rootInput, profileId: z.string(), sourceSessionId: z.string(), sessionId: z.string() }),
    output: z.object({ adopted: z.literal(true) }) },
  // Stock BB forks Claude sessions outside the account; see src/accounts/fork-stage.ts.
  stageFork: { input: z.object({ ...rootInput, profileId: z.string(), sessionId: z.string(), forkThreadId: z.string() }),
    output: z.object({ link: z.string(), target: z.string() }) },
  unstageFork: { input: z.object({ forkThreadId: z.string(), forkSessionId: z.string().nullable() }),
    output: z.object({ removed: z.boolean(), forked: z.boolean().nullable() }) },
  sweepForkStages: { input: z.object({ maxAgeMs: z.number() }), output: z.object({ removed: z.array(z.string()) }) },
  ampUsage: { input: z.object({}), output: ampReadingSchema },
  grokUsage: { input: z.object({}), output: measurementSchema },
  antigravityUsage: { input: z.object({ accountId: z.string().default('default') }), output: measurementSchema },
  ...usageHostContract,
});
// A null thread is the new-thread composer: its choice is remembered and claimed by the next Claude thread's first send.
// A handoff draft composes in its non-Claude source thread. Its send creates a new Claude thread, so it targets that same choice.
export const accountsContract = defineRpcContract({
  antigravityAccounts: { input: z.object({ hostId: z.string() }), output: z.array(keyedProfileSchema) },
  antigravityQuota: { input: z.object({ hostId: z.string(), providerId: z.string() }), output: usageSchema },
  accounts: { input: z.object({ threadId: z.string().nullable() }), output: z.object({
    supported: z.boolean(), target: z.enum(['thread', 'next']), profiles: z.array(keyedProfileSchema), currentId: z.string(),
    // An account chosen during a turn; it applies when the thread is next idle.
    pendingId: z.string().nullable(),
  }) },
  // `replace` answers a conflict that an earlier choose returned: the target's copy moves aside.
  choose: { input: z.object({ threadId: z.string().nullable(), profileId: z.string(), replace: z.boolean().default(false) }),
    output: z.object({ currentId: z.string(), conflict: historyConflictSchema.nullable() }) },
  usage: { input: z.object({ threadId: z.string(), profileId: z.string(), refresh: z.boolean() }), output: usageSchema },
  // A draft has no thread yet, so its quota is read on the machine that lists its accounts.
  nextThreadQuota: { input: z.object({ profileId: z.string() }), output: usageSchema },
  // Threads on Default are omitted: the sidebar badges only named accounts.
  threadAccounts: { input: z.object({}), output: z.array(threadAccountSchema) },
});
export const rpcContract = defineRpcContract({ ...accountsContract, ...modelsContract, ...usageContract, ...connectorsContract });
export const usageSourceContract = defineRpcContract({
  'provider-usage.v1.listResources': {
    input: z.object({}), output: z.object({ resources: z.array(resourceSchema) }),
    experimental_description: 'List Claude, Grok and Antigravity quota resources on BB hosts without requesting quota.',
  },
  'provider-usage.v1.getResource': {
    input: z.object({ resourceId: z.string(), refresh: z.boolean() }), output: measurementSchema,
    experimental_description: 'Read one quota resource through its native CLI. Refresh bypasses its cache.',
  },
});
