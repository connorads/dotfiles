import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const maskSchema = z.enum(['off', 'hide-rest']);

export const viewSchema = z.object({
  activeSetId: z.string().nullable(),
  sets: z.array(z.object({ id: z.string(), name: z.string(), projects: z.array(z.string()), mask: maskSchema })),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type FocusView = z.infer<typeof viewSchema>;

const empty = z.object({});
const setId = z.string().min(1);
const name = z.string().trim().min(1).max(40);

export const rpcContract = defineRpcContract({
  view: { input: empty, output: viewSchema },
  /** Turns a set on, switching from any running set, or off when null. */
  activate: { input: z.object({ setId: setId.nullable() }), output: viewSchema },
  /** Turns the running set off, or the last used set on. */
  swap: { input: empty, output: viewSchema },
  createSet: { input: z.object({ name }), output: viewSchema },
  renameSet: { input: z.object({ setId, name }), output: viewSchema },
  deleteSet: { input: z.object({ setId }), output: viewSchema },
  setProject: { input: z.object({ setId, projectId: z.string().min(1), included: z.boolean() }), output: viewSchema },
  setMask: { input: z.object({ setId, mask: maskSchema }), output: viewSchema },
});
