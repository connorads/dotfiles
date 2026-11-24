import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const connectionAppView = z.object({
  app: z.string(),
  account: z.string().nullable(),
  ok: z.boolean(),
  reason: z.string().nullable(),
});
export type ConnectionAppView = z.infer<typeof connectionAppView>;

export const connectionHealthState = z.enum(["unknown", "checking", "ok", "degraded", "reauth", "unreachable"]);
export type ConnectionHealthState = z.infer<typeof connectionHealthState>;

export const connectionHealthView = z.object({
  state: connectionHealthState,
  checkedAt: z.number().nullable(),
  message: z.string().nullable(),
  apps: z.array(connectionAppView),
  toolCount: z.number().nullable(),
});
export type ConnectionHealthView = z.infer<typeof connectionHealthView>;

export const connectionView = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  host: z.string(),
  webUrl: z.string(),
  approvalMode: z.enum(["model", "browser"]),
  status: z.enum(["signed-in", "signed-out", "signing-in"]),
  isDefault: z.boolean(),
  health: connectionHealthView,
});
export type ConnectionView = z.infer<typeof connectionView>;

export const scopedChoiceView = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connection"), id: z.string() }),
  z.object({ kind: z.literal("off") }),
]);
export type ScopedChoiceView = z.infer<typeof scopedChoiceView>;

export const projectView = z.object({
  id: z.string(),
  name: z.string(),
  choice: scopedChoiceView.nullable(),
});
export type ProjectView = z.infer<typeof projectView>;

export const ownerResolutionView = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connection"), id: z.string() }),
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("unset") }),
]);
export type OwnerResolutionView = z.infer<typeof ownerResolutionView>;

export const signInView = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("browser"), id: z.string(), url: z.string(), expiresAt: z.number() }),
  z.object({
    kind: z.literal("device"),
    id: z.string(),
    userCode: z.string(),
    verificationUri: z.string(),
    verificationUriComplete: z.string().nullable(),
    expiresAt: z.number(),
  }),
]);
export type SignInView = z.infer<typeof signInView>;

export const stateView = z.object({
  connections: z.array(connectionView),
  defaultChoice: scopedChoiceView.nullable(),
  projects: z.array(projectView),
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
  setDefault: {
    input: z.union([id, z.object({ choice: scopedChoiceView })]),
    output: z.null(),
  },
  setProjectChoice: {
    input: z.object({ projectId: z.string(), choice: threadChoice }),
    output: z.null(),
  },
  signIn: { input: z.object({ id: z.string(), method: z.enum(["browser", "device"]).default("browser") }), output: z.null() },
  cancelSignIn: { input: id, output: z.null() },
  signOut: { input: id, output: z.null() },
  check: { input: z.object({ id: z.string(), force: z.boolean().default(true) }), output: z.null() },
  checkAll: { input: z.object({ force: z.boolean().default(false) }), output: z.null() },
  threadChoice: { input: z.object({ threadId: z.string() }), output: threadChoice },
  threadOwner: { input: z.object({ threadId: z.string(), projectId: z.string().nullable().optional() }), output: ownerResolutionView.nullable() },
  setThreadChoice: { input: z.object({ threadId: z.string(), choice: threadChoice }), output: z.null() },
});

/** Realtime event telling windows to refetch `state`. */
export const STATE_CHANGED = "state";
/** Realtime event naming the thread whose choice changed. */
export const THREAD_CHANGED = "thread";
