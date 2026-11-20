import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const organizationModeSchema = z.enum(['project', 'chronological', 'machine']);
export type OrganizationMode = z.infer<typeof organizationModeSchema>;

export const restoreModeSchema = z.enum(['project', 'machine']);
export type RestoreMode = z.infer<typeof restoreModeSchema>;

export const viewSchema = z.object({
  mode: organizationModeSchema,
  restoreMode: restoreModeSchema,
});
export type RecentView = z.infer<typeof viewSchema>;

const empty = z.object({});

export const rpcContract = defineRpcContract({
  view: { input: empty, output: viewSchema },
  toggle: { input: empty, output: viewSchema },
});
