import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

/** A profile name, "off", or "inherit" (clear this level). */
const value = z.string().min(1).max(64);

export const resolvedView = z.object({
  profile: z.string().nullable(),
  source: z.enum(['thread', 'project', 'default']),
});
export type ResolvedView = z.infer<typeof resolvedView>;

export const stateView = z.object({
  profiles: z.array(z.string()),
  defaultChoice: z.string(),
  projects: z.array(z.object({ id: z.string(), name: z.string(), choice: z.string().nullable() })),
});
export type StateView = z.infer<typeof stateView>;

export const threadView = z.object({
  threadId: z.string(),
  own: z.string().nullable(),
  resolved: resolvedView,
});
export type ThreadView = z.infer<typeof threadView>;

export const draftView = z.object({
  projectId: z.string(),
  own: z.string().nullable(),
  resolved: resolvedView,
});
export type DraftView = z.infer<typeof draftView>;

export const toolView = z.object({
  name: z.string(),
  description: z.string(),
  readOnly: z.boolean(),
  access: z.enum(['allow', 'off']),
});
export type ToolRow = z.infer<typeof toolView>;

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateView },
  thread: { input: z.object({ threadId: z.string(), projectId: z.string() }), output: threadView },
  setThread: { input: z.object({ threadId: z.string(), value }), output: z.null() },
  draft: { input: z.object({ projectId: z.string() }), output: draftView },
  setDraft: { input: z.object({ projectId: z.string(), value }), output: z.null() },
  setProject: { input: z.object({ projectId: z.string(), value }), output: z.null() },
  setDefault: { input: z.object({ value }), output: z.null() },
  connectors: {
    input: z.object({ profile: z.string() }),
    output: z.object({ connectors: z.array(z.string()), error: z.string().nullable() }),
  },
  tools: {
    input: z.object({ profile: z.string(), connector: z.string() }),
    output: z.object({ tools: z.array(toolView), error: z.string().nullable() }),
  },
  setAccess: {
    input: z.object({ profile: z.string(), connector: z.string(), tool: z.string(), access: z.enum(['allow', 'off']) }),
    output: z.null(),
  },
});

/** Realtime event telling windows to refetch. */
export const CHANGED = 'changed';
