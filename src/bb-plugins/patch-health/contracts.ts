import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { snapshotSchema } from './model';
import { labActionSchema, labStateSchema } from './lab-model';
const labMethods = {
  labStatus: { input: z.object({}).strict(), output: labStateSchema },
  prepareLab: { input: z.object({}).strict(), output: labStateSchema },
  runLab: { input: labActionSchema, output: labStateSchema },
  reconcileLab: { input: labActionSchema, output: labStateSchema },
};
export const hostContract = defineRpcContract({ ...labMethods, inspect: { input: z.object({}).strict(), output: snapshotSchema } });
export const rpcContract = defineRpcContract({ ...labMethods, inspect: { input: z.object({}).strict(), output: z.object({ hostId: z.string().nullable(), snapshot: snapshotSchema }) } });
