import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { snapshotSchema } from './model';
export const hostContract = defineRpcContract({ inspect: { input: z.object({}).strict(), output: snapshotSchema } });
export const rpcContract = defineRpcContract({ inspect: { input: z.object({}).strict(), output: z.object({ hostId: z.string().nullable(), snapshot: snapshotSchema }) } });
