import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const viewSchema = z.object({
  active: z.boolean(),
  projects: z.array(z.object({ id: z.string(), name: z.string(), member: z.boolean(), always: z.boolean() })),
});
export type FocusView = z.infer<typeof viewSchema>;

const empty = z.object({});
const projectId = z.string().min(1);

export const rpcContract = defineRpcContract({
  view: { input: empty, output: viewSchema },
  /** Turns the view on with the picked projects (or this one when none are picked), or off. */
  toggle: { input: z.object({ projectId: projectId.nullable() }), output: viewSchema },
  setMember: { input: z.object({ projectId, included: z.boolean() }), output: viewSchema },
  setAlwaysShow: { input: z.object({ projectId, on: z.boolean() }), output: viewSchema },
});
