import { z } from 'zod';

export const archiveTargetSchema = z.object({
  threadId: z.string(), title: z.string(), projectId: z.string(),
  running: z.boolean(), children: z.number().int().nonnegative(),
});
export type ArchiveTarget = z.infer<typeof archiveTargetSchema>;
const receiptSchema = z.object({ target: archiveTargetSchema, ids: z.array(z.string()) });
const receiptsSchema = z.array(receiptSchema).max(10);
export const archiveResultSchema = z.object({
  outcome: z.enum(['confirmation', 'archived', 'restored', 'partial', 'empty']),
  message: z.string(), target: archiveTargetSchema.optional(),
});
export type ArchiveResult = z.infer<typeof archiveResultSchema>;

export interface ArchivePorts {
  get(id: string): Promise<{ id: string; title: string | null; projectId: string; status: string; archivedAt: number | null; activeBackgroundAgentCount?: number; queuedMessageCount?: number }>;
  children(id: string): Promise<number>;
  archive(id: string): Promise<string[]>;
  unarchive(id: string): Promise<void>;
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

export function makeArchives(ports: ArchivePorts) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };
  const load = async () => {
    const value = await ports.load();
    return value === undefined ? [] : receiptsSchema.parse(value);
  };
  const inspect = async (threadId: string): Promise<ArchiveTarget> => {
    const [thread, children] = await Promise.all([ports.get(threadId), ports.children(threadId)]);
    if (thread.archivedAt !== null) throw new Error('This thread is already archived.');
    return { threadId, title: thread.title ?? threadId, projectId: thread.projectId, children,
      running: !['idle', 'error'].includes(thread.status) || (thread.activeBackgroundAgentCount ?? 0) > 0 || (thread.queuedMessageCount ?? 0) > 0 };
  };
  return {
    inspect,
    archive: (expected: ArchiveTarget, confirmed: boolean): Promise<ArchiveResult> => serial(async () => {
      const target = await inspect(expected.threadId);
      if ((target.running || target.children > 0) && (!confirmed || target.running !== expected.running || target.children !== expected.children)) {
        return { outcome: 'confirmation', target,
          message: `Archive “${target.title}”?${target.running ? ' This will stop current or queued work.' : ''}${target.children ? ` Includes ${target.children} child threads.` : ''} Say “confirm archive” or “cancel archive”.` };
      }
      const receipts = await load();
      // Check storage before changing BB state.
      await ports.save(receipts);
      const ids = await ports.archive(target.threadId);
      if (!ids.length) throw new Error('No threads were archived. Say the command again.');
      receipts.push({ target, ids: [...ids].reverse() });
      await ports.save(receipts.slice(-10));
      return { outcome: 'archived', target,
        message: `Archived “${target.title}”${ids.length > 1 ? ` and ${ids.length - 1} child threads` : ''}. Say “unarchive last thread” to restore. Restoring does not restart stopped work.` };
    }),
    restore: (): Promise<ArchiveResult> => serial(async () => {
      const receipts = await load();
      const receipt = receipts.at(-1);
      if (!receipt) return { outcome: 'empty', message: 'There is no voice archive to restore.' };
      while (receipt.ids.length) {
        const id = receipt.ids[0];
        if (!id) break;
        try { await ports.unarchive(id); }
        catch (cause) {
          return { outcome: 'partial', target: receipt.target,
            message: `Could not finish restoring “${receipt.target.title}”. ${cause instanceof Error ? cause.message : String(cause)} Say “unarchive last thread” to retry the remaining threads.` };
        }
        receipt.ids.shift();
        await ports.save(receipts);
      }
      receipts.pop();
      await ports.save(receipts);
      return { outcome: 'restored', target: receipt.target, message: `Restored “${receipt.target.title}”. Stopped work is not restarted.` };
    }),
  };
}
