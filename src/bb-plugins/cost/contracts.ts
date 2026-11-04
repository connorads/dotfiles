import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { providers, type UsageRecord } from './src/records.ts';
import type { ProjectLine, Summary, ThreadCost } from './src/report.ts';

const provider = z.enum(providers);
const context = z.object({ sessionId: z.string().optional(), cwd: z.string().optional(), model: z.string().optional(),
  speed: z.enum(['standard', 'fast']).optional(), skipLine: z.boolean().optional() });

export const hostContract = defineRpcContract({
  /** Session logs on this host changed at or after `since`. */
  list: {
    input: z.object({ claudeConfigDirs: z.array(z.string()), since: z.number() }),
    output: z.object({ files: z.array(z.object({ provider, path: z.string(), size: z.number(), mtimeMs: z.number() })) }),
  },
  read: {
    input: z.object({ provider, path: z.string(), offset: z.number().int().nonnegative(), context }),
    output: z.object({ offset: z.number(), context, records: z.array(z.custom<UsageRecord>()), sessions: z.record(z.string(), z.string()) }),
  },
});

export interface ThreadView extends ThreadCost { pricesAt: number | null; title: string | null }
export interface ThreadMeta { title: string; projectName: string | null; provider: string }
export interface Plan { name: string; usd: number }
export interface SummaryView extends Summary {
  pricesAt: number | null; firstDay: string; lastDay: string;
  threadInfo: Record<string, ThreadMeta>; projects: ProjectLine[]; plans: Plan[]; monthUsd: number; firstAt: number | null;
}
export interface Progress {
  state: 'idle' | 'running' | 'failed'; startedAt: number | null; finishedAt: number | null; error: string | null;
  files: number; filesDone: number; bytes: number; bytesDone: number; records: number;
}

export const periods = [7, 30, 90] as const;
export const rpcContract = defineRpcContract({
  thread: { input: z.object({ threadId: z.string() }), output: z.custom<ThreadView>().nullable() },
  summary: { input: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }), output: z.custom<SummaryView>() },
  progress: { input: z.object({}), output: z.custom<Progress>() },
});
