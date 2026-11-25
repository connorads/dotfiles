import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract, type FileSourceInput, type HostAudioEntry, type SiblingAudio } from './contracts';
import { dirname, fileExtension, joinUnderRoot, normalizePosixPath, relativeUnderRoot } from './src/audio';

export interface SiblingSdk {
  environments: {
    get(args: { environmentId: string; signal?: AbortSignal }): Promise<{ hostId: string; path: string | null }>;
  };
  projects: {
    get(args: { projectId: string; signal?: AbortSignal }): Promise<{
      sources: ReadonlyArray<{ hostId: string; path: string; isDefault: boolean }>;
    }>;
  };
  threads: {
    get(args: { threadId: string; signal?: AbortSignal }): Promise<{ environmentId: string | null }>;
    storageLocation(args: { threadId: string; signal?: AbortSignal }): Promise<{
      hostId: string;
      storageRootPath: string;
    }>;
  };
}

export type HostAudioLister = (
  hostId: string,
  dir: string,
) => Promise<{ items: HostAudioEntry[]; truncated: boolean }>;

interface ResolvedDirectory {
  hostId: string;
  dir: string;
  rootPath: string | null;
  directoryLabel: string;
}

async function resolveDirectory(
  sdk: SiblingSdk,
  filePath: string,
  source: FileSourceInput,
  signal?: AbortSignal,
): Promise<ResolvedDirectory | null> {
  if (source.kind === 'workspace') {
    let hostId: string | null = null;
    let rootPath: string | null = null;

    if (source.environmentId !== null) {
      const env = await sdk.environments.get({ environmentId: source.environmentId, signal });
      hostId = env.hostId;
      rootPath = env.path;
    } else if (source.projectId !== null) {
      const project = await sdk.projects.get({ projectId: source.projectId, signal });
      const chosen =
        (source.experimental_hostId
          ? project.sources.find((item) => item.hostId === source.experimental_hostId)
          : undefined) ??
        project.sources.find((item) => item.isDefault) ??
        project.sources[0];
      if (chosen) {
        hostId = chosen.hostId;
        rootPath = chosen.path;
      }
    }

    if (!hostId || !rootPath) return null;
    const fullFile = joinUnderRoot(rootPath, filePath);
    if (!fullFile) return null;
    const dir = dirname(fullFile);
    if (!dir) return null;
    const relDir = relativeUnderRoot(rootPath, dir) ?? '';
    return {
      hostId,
      dir,
      rootPath: normalizePosixPath(rootPath),
      directoryLabel: relDir || '/',
    };
  }

  if (source.kind === 'thread-storage') {
    if (source.threadId === null) return null;
    const location = await sdk.threads.storageLocation({ threadId: source.threadId, signal });
    const fullFile = joinUnderRoot(location.storageRootPath, filePath);
    if (!fullFile) return null;
    const dir = dirname(fullFile);
    if (!dir) return null;
    const relDir = relativeUnderRoot(location.storageRootPath, dir) ?? '';
    return {
      hostId: location.hostId,
      dir,
      rootPath: normalizePosixPath(location.storageRootPath),
      directoryLabel: relDir ? `thread-storage/${relDir}` : 'thread-storage',
    };
  }

  // source.kind === 'host'
  const normalized = normalizePosixPath(filePath);
  if (!normalized.startsWith('/')) return null;
  let hostId = source.experimental_hostId ?? null;
  if (!hostId && source.environmentId !== null) {
    const env = await sdk.environments.get({ environmentId: source.environmentId, signal });
    hostId = env.hostId;
  }
  if (!hostId && source.threadId !== null) {
    const thread = await sdk.threads.get({ threadId: source.threadId, signal });
    if (thread.environmentId !== null) {
      const env = await sdk.environments.get({ environmentId: thread.environmentId, signal });
      hostId = env.hostId;
    } else {
      const location = await sdk.threads.storageLocation({ threadId: source.threadId, signal });
      hostId = location.hostId;
    }
  }
  if (!hostId) return null;
  const dir = dirname(normalized);
  if (!dir) return null;
  return {
    hostId,
    dir,
    rootPath: null,
    directoryLabel: dir,
  };
}

export interface ListSiblingRequest {
  filePath: string;
  source: FileSourceInput;
  signal?: AbortSignal;
}

export async function listSiblingAudio(
  sdk: SiblingSdk,
  listHostAudio: HostAudioLister,
  request: ListSiblingRequest,
): Promise<{ directoryLabel: string; items: SiblingAudio[]; truncated: boolean }> {
  const { filePath, source, signal } = request;
  const resolved = await resolveDirectory(sdk, filePath, source, signal);
  if (!resolved) {
    return { directoryLabel: dirname(filePath), items: [], truncated: false };
  }

  const listing = await listHostAudio(resolved.hostId, resolved.dir);
  const items: SiblingAudio[] = [];

  for (const entry of listing.items) {
    const absoluteEntry = resolved.dir === '/' ? `/${entry.name}` : `${resolved.dir}/${entry.name}`;
    const entryPath = resolved.rootPath
      ? relativeUnderRoot(resolved.rootPath, absoluteEntry)
      : absoluteEntry;
    if (!entryPath) continue;
    const extension = fileExtension(entry.name);
    if (!extension) continue;
    items.push({
      name: entry.name,
      path: entryPath,
      extension,
      sizeBytes: entry.sizeBytes,
      mtimeMs: entry.mtimeMs,
    });
  }

  return {
    directoryLabel: resolved.directoryLabel,
    items,
    truncated: listing.truncated,
  };
}

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  bb.rpc.register(rpcContract, {
    listSiblings: async ({ path, source }, context) => {
      try {
        return await listSiblingAudio(
          bb.sdk,
          (hostId, dir) => host.call('listAudio', { dir }, { hostId }),
          {
            filePath: path,
            source,
            signal: context.experimental_signal,
          },
        );
      } catch (error) {
        bb.log.warn(
          `Failed to list sibling audio files (${source.kind} ${path}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { directoryLabel: dirname(path), items: [], truncated: false };
      }
    },
  });
}
