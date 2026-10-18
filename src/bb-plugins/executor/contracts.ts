import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const connectionView = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  status: z.enum(["signed-in", "signed-out", "signing-in"]),
  isDefault: z.boolean(),
});
export type ConnectionView = z.infer<typeof connectionView>;

export const signInView = z.object({
  id: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string().nullable(),
  expiresAt: z.number(),
});
export type SignInView = z.infer<typeof signInView>;

export const stateView = z.object({
  connections: z.array(connectionView),
  signIns: z.array(signInView),
  /** Last failure per connection, cleared by the next success. */
  errors: z.record(z.string(), z.string()),
  toolsReady: z.boolean(),
});
export type StateView = z.infer<typeof stateView>;

export const threadChoice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }),
  z.object({ kind: z.literal("connection"), id: z.string() }),
  z.object({ kind: z.literal("off") }),
]);

const id = z.object({ id: z.string() });

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateView },
  add: {
    input: z.object({ name: z.string().trim().min(1).max(60), url: z.string().max(2000) }),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), id: z.string() }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  remove: { input: id, output: z.null() },
  setDefault: { input: id, output: z.null() },
  signIn: { input: id, output: z.null() },
  cancelSignIn: { input: id, output: z.null() },
  signOut: { input: id, output: z.null() },
  threadChoice: { input: z.object({ threadId: z.string() }), output: threadChoice },
  setThreadChoice: { input: z.object({ threadId: z.string(), choice: threadChoice }), output: z.null() },
});

/** Realtime event telling windows to refetch `state`. */
export const STATE_CHANGED = "state";
/** Realtime event naming the thread whose choice changed. */
export const THREAD_CHANGED = "thread";
