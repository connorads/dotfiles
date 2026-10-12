import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import type { Task } from './src/tasks.ts';
const date = z.union([
  z.object({ kind: z.literal('none'), label: z.string() }),
  z.object({ kind: z.literal('event'), label: z.string() }),
  z.object({
    kind: z.enum(['due', 'before', 'available', 'week']),
    value: z.string(),
    label: z.string(),
  }),
]);
const task: z.ZodType<Task> = z.object({
  id: z.string(),
  title: z.string(),
  raw: z.string(),
  path: z.string(),
  line: z.number(),
  section: z.string(),
  area: z.string(),
  state: z.enum(['next', 'doing', 'waiting', 'triage']),
  date,
  links: z.array(
    z.object({
      label: z.string(),
      url: z.string(),
      path: z.string().nullable(),
    }),
  ),
});
const source = z.object({
  id: z.string(),
  hostId: z.string(),
  path: z.string(),
  isDefault: z.boolean(),
});
const project = z.object({
  id: z.string(),
  name: z.string(),
  sources: z.array(source),
});
export type Project = z.infer<typeof project>;
const selection = z.object({
  projectId: z.string().min(1),
  sourceId: z.string().nullable(),
});
const snapshot = z.object({
  projectId: z.string(),
  source: source.nullable(),
  taskFile: z.string(),
  tasks: z.array(task),
  reviewed: z.string().nullable(),
  readAt: z.string(),
  error: z.string().nullable(),
});
export type Snapshot = z.infer<typeof snapshot>;
export const rpcContract = defineRpcContract({
  projects: {
    input: z.object({}),
    output: z.object({ projects: z.array(project) }),
  },
  snapshot: { input: selection, output: snapshot },
  configure: {
    input: z.object({
      projectId: z.string().min(1),
      taskFile: z.string().trim().min(1).max(300),
    }),
    output: z.object({ taskFile: z.string() }),
  },
  context: {
    input: selection.extend({ taskId: z.string(), path: z.string() }),
    output: z.object({ content: z.string(), path: z.string() }),
  },
});
