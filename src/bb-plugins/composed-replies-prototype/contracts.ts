import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const inputSchema = z
  .object({
    format: z.enum(["openui", "json-render"]),
    source: z.string().min(1).max(50000),
    title: z.string().min(1).max(100),
  })
  .strict();
export const idSchema = z.uuid();
export const rpcContract = defineRpcContract({
  read: {
    input: z.object({ threadId: z.string().min(1), id: idSchema }),
    output: inputSchema,
  },
});
export type Composition = z.infer<typeof inputSchema>;
