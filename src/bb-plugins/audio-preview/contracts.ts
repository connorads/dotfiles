import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const fileSourceSchema = z.object({
  kind: z.enum(['workspace', 'host', 'thread-storage']),
  threadId: z.string().nullable(),
  environmentId: z.string().nullable(),
  projectId: z.string().nullable(),
  experimental_hostId: z.string().optional(),
});

export const hostAudioEntrySchema = z.object({
  name: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable(),
  mtimeMs: z.number().nonnegative().nullable(),
});

export const siblingAudioSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  extension: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable(),
  mtimeMs: z.number().nonnegative().nullable(),
});

export type FileSourceInput = z.infer<typeof fileSourceSchema>;
export type HostAudioEntry = z.infer<typeof hostAudioEntrySchema>;
export type SiblingAudio = z.infer<typeof siblingAudioSchema>;

export const hostContract = defineRpcContract({
  listAudio: {
    input: z.object({
      dir: z.string().startsWith('/'),
    }),
    output: z.object({
      items: z.array(hostAudioEntrySchema),
      truncated: z.boolean(),
    }),
  },
});

export const rpcContract = defineRpcContract({
  listSiblings: {
    input: z.object({
      path: z.string().min(1),
      source: fileSourceSchema,
    }),
    output: z.object({
      directoryLabel: z.string(),
      items: z.array(siblingAudioSchema),
      truncated: z.boolean(),
    }),
  },
});
