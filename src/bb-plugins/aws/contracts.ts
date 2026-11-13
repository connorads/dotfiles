import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const choice = z.object({ profile: z.string().nullable(), region: z.string().nullable() });

export const stateView = z.object({
  profiles: z.array(z.object({
    name: z.string(),
    region: z.string().nullable(),
    status: z.enum(['ok', 'sign-in', 'signing-in']),
  })),
  /** Why the profile list could not be read, if it could not. */
  error: z.string().nullable(),
});
export type StateView = z.infer<typeof stateView>;

export const threadView = z.object({
  choice,
  /** The region the thread's agent reads now. */
  region: z.string().nullable(),
  /** When the thread's agent last received credentials, and for which profile. */
  lastFetch: z.object({ profile: z.string(), at: z.number() }).nullable(),
});
export type ThreadView = z.infer<typeof threadView>;

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateView },
  thread: { input: z.object({ threadId: z.string() }), output: threadView },
  setChoice: { input: z.object({ threadId: z.string(), choice }), output: z.null() },
  signIn: {
    input: z.object({ profile: z.string() }),
    output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), message: z.string() })]),
  },
});

/** Realtime event telling windows to refetch. */
export const CHANGED = 'changed';
