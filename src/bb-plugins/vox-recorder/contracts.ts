import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { candidateSchema } from './src/ingestion.ts';

export const statusSchema = z.object({
  state: z.enum(['recording', 'transcribing', 'empty', 'ready', 'idle']),
  recording: z.object({ dir: z.string(), startedAt: z.number().nullable() }).nullable(),
  jobs: z.object({ count: z.number(), oldestStartedAt: z.number().nullable(), newestDir: z.string().nullable() }),
  unread: z.number(),
  empty: z.number(),
});
export const recordingSchema = z.object({
  name: z.string(), title: z.string(), startedAt: z.number(), bytes: z.number(),
  kind: z.enum(['recording', 'transcribing', 'pending', 'empty', 'solo', '2-way']),
});
export const previewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transcript'), text: z.string(), truncated: z.boolean() }),
  z.object({ kind: z.literal('empty'), log: z.string() }),
  z.object({ kind: z.literal('transcribing'), log: z.string() }),
  z.object({ kind: z.literal('none'), files: z.array(z.string()) }),
]);
const outcome = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), path: z.string() }),
  z.object({ ok: z.literal(false), path: z.string().nullable(), reason: z.string() }),
]);
const grabResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), id: z.string(), label: z.string(), words: z.number() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
const name = z.string().min(1);
const names = z.array(name).min(1);
const window = z.string().regex(/^\d+[smh]?$/).nullable();
const empty = z.object({});

const shared = {
  status: { input: empty, output: statusSchema },
  list: { input: empty, output: z.array(recordingSchema) },
  preview: { input: z.object({ name }), output: previewSchema },
  transcript: { input: z.object({ name }), output: z.object({ path: z.string(), text: z.string() }) },
  markSeen: { input: empty, output: empty },
  start: { input: empty, output: outcome },
  /** Detaches: transcription takes minutes, so the result arrives as a `finished` signal. */
  stop: { input: empty, output: z.object({ dir: z.string() }) },
  cancel: { input: empty, output: empty },
  rename: { input: z.object({ name, title: z.string() }), output: outcome },
  transcribe: { input: z.object({ names }), output: empty },
  remove: { input: z.object({ names }), output: z.object({ removed: z.array(z.string()) }) },
  reclaim: { input: z.object({ names }), output: empty },
  reveal: { input: z.object({ name }), output: empty },
  grab: { input: z.object({ window }), output: grabResult },
} as const;

export const hostContract = defineRpcContract({
  ...shared,
  /** Start watching the store and statefile (idempotent); changes arrive as `status` signals. */
  subscribe: { input: empty, output: statusSchema },
  completed: { input: empty, output: z.array(candidateSchema) },
  readGrab: { input: z.object({ id: z.string() }), output: z.object({ path: z.string(), text: z.string() }) },
  /** Where a host-side file lives, for BB's file preview. */
  transcriptPath: { input: z.object({ name }), output: z.object({ path: z.string() }) },
});
export const finishedSchema = z.object({
  action: z.enum(['stop', 'transcribe']), name: z.string(), ok: z.boolean(), reason: z.string().nullable(),
});
export const hostSignals = {
  status: { payload: statusSchema },
  finished: { payload: finishedSchema },
  transcriptsChanged: { payload: empty },
};

export const rpcContract = defineRpcContract({
  ...shared,
  /** The machine vox runs on, so the app can open host files in BB's preview. */
  location: { input: z.object({ name }), output: z.object({ hostId: z.string(), path: z.string() }) },
});

export type VoxStatusDto = z.infer<typeof statusSchema>;
export type RecordingDto = z.infer<typeof recordingSchema>;
export type PreviewDto = z.infer<typeof previewSchema>;
export type Finished = z.infer<typeof finishedSchema>;
