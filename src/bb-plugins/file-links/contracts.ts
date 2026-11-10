import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const hostContract = defineRpcContract({
  exists: {input:z.object({path:z.string().startsWith('/')}),output:z.boolean()},
});
export const rpcContract = defineRpcContract({
  exists: {input:z.object({hostId:z.string().min(1),path:z.string().startsWith('/')}),output:z.boolean()},
});
