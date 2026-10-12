import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const htmlInput = z.object({ html: z.string().min(1).max(200_000), title: z.string().trim().min(1).max(100) });
export const visualId = z.uuid();
export const rpcContract = defineRpcContract({
  read: {
    input: z.object({ threadId: z.string().min(1), id: visualId }),
    output: htmlInput,
  },
});
