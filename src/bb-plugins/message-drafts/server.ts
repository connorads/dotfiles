import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { draftSchema, rpcContract, writeSchema, type Draft } from './contracts.ts';

export default function plugin(bb: BbPluginApi) {
  const pending = new Map<string, Promise<unknown>>();
  const key = (threadId: string) => `draft:${threadId}`;
  const read = async (threadId: string): Promise<Draft> => draftSchema.parse(
    await bb.storage.kv.get(key(threadId)) ?? { text: '', revision: 0 });
  const write = (threadId: string, text: string, revision: number) => {
    const task = (pending.get(threadId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const current = await read(threadId);
      if (current.revision !== revision) return { ok: false as const, revision: current.revision,
        error: 'Draft changed. Read it before writing again.' as const };
      const next = { text, revision: revision + 1 };
      await bb.storage.kv.set(key(threadId), next);
      return { ok: true as const, revision: next.revision };
    });
    pending.set(threadId, task);
    void task.finally(() => { if (pending.get(threadId) === task) pending.delete(threadId); }).catch(() => {});
    return task;
  };
  bb.rpc.register(rpcContract, {
    read: ({ threadId }) => read(threadId),
    write: ({ threadId, text, revision }) => write(threadId, text, revision),
  });
  bb.agents.registerTool({ name: 'draft_read', description: 'Read this thread’s saved message draft and revision before editing it.',
    parameters: z.object({}), execute: (_input, { threadId }) => read(threadId).then(JSON.stringify) });
  bb.agents.registerTool({ name: 'draft_write', description: 'Create or replace this thread’s message draft. Pass its current revision from draft_read; use 0 for an empty draft. Returns a conflict if newer edits exist. Maximum 16000 characters.',
    instructions: 'Use draft_read and draft_write for messages the user wants in the Message Drafts side panel. Read before revising. Keep only the message in the draft. After saving, emit ::message-draft on its own line to show an Open message draft button. Never send it externally.',
    parameters: writeSchema, execute: ({ text, revision }, { threadId }) => write(threadId, text, revision).then(JSON.stringify) });
}
