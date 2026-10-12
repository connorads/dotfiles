import { posix } from 'node:path';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { rpcContract, type Snapshot } from './contracts.ts';
import { parseTasks, relativeMarkdownPath } from './src/tasks.ts';

export default function plugin(bb: BbPluginApi) {
  async function taskFileFor(projectId: string) {
    return (
      (await bb.storage.kv.get<string>(`source:${projectId}`)) ?? 'TODO.md'
    );
  }
  async function snapshot(
    projectId: string,
    sourceId: string | null,
  ): Promise<Snapshot> {
    const project = await bb.sdk.projects.get({ projectId });
    const source = sourceId
      ? project.sources.find((s) => s.id === sourceId)
      : (project.sources.find((s) => s.isDefault) ?? project.sources[0]);
    const taskFile = await taskFileFor(projectId);
    const base = {
      projectId,
      source: source ?? null,
      taskFile,
      tasks: [],
      reviewed: null,
      readAt: new Date().toISOString(),
      error: null,
    };
    if (!source)
      return {
        ...base,
        error: 'This project has no checkout on a connected host.',
      };
    try {
      if (relativeMarkdownPath('ROOT.md', taskFile) !== taskFile)
        throw new Error('Choose a Markdown path inside the project.');
      const file = await bb.sdk.files.read({
        hostId: source.hostId,
        rootPath: source.path,
        path: posix.join(source.path, taskFile),
      });
      if (file.contentEncoding !== 'utf8' || file.sizeBytes > 262144)
        throw new Error(
          'The task source must be a UTF-8 Markdown file below 256 KiB.',
        );
      return { ...base, ...parseTasks(file.content, taskFile) };
    } catch (cause) {
      return {
        ...base,
        error: `Could not read ${taskFile}. ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
  bb.rpc.register(rpcContract, {
    projects: async () => ({
      projects: (await bb.sdk.projects.list()).map((p) => ({
        id: p.id,
        name: p.name,
        sources: p.sources,
      })),
    }),
    snapshot: ({ projectId, sourceId }) => snapshot(projectId, sourceId),
    configure: async ({ projectId, taskFile }) => {
      if (relativeMarkdownPath('ROOT.md', taskFile) !== taskFile)
        throw new Error(
          'Use a relative .md path without hidden folders or traversal outside the project.',
        );
      await bb.sdk.projects.get({ projectId });
      await bb.storage.kv.set(`source:${projectId}`, taskFile);
      return { taskFile };
    },
    context: async ({ projectId, sourceId, taskId, path }) => {
      const current = await snapshot(projectId, sourceId);
      if (current.error || !current.source)
        throw new Error(current.error ?? 'No checkout selected.');
      if (
        !current.tasks
          .find((t) => t.id === taskId)
          ?.links.some((link) => link.path === path)
      )
        throw new Error(
          'This document is not linked by the current task. Refresh the task list.',
        );
      const file = await bb.sdk.files.read({
        hostId: current.source.hostId,
        rootPath: current.source.path,
        path: posix.join(current.source.path, path),
      });
      if (file.contentEncoding !== 'utf8' || file.sizeBytes > 524288)
        throw new Error(
          'Open this document in BB. Inline context supports UTF-8 Markdown below 512 KiB.',
        );
      return { content: file.content, path };
    },
  });
}
