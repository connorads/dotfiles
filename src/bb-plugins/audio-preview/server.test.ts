import { describe, expect, test } from 'vitest';
import { listSiblingAudio, type HostAudioLister, type SiblingSdk } from './server';

function fakeSdk(): SiblingSdk {
  return {
    environments: {
      async get({ environmentId }) {
        if (environmentId === 'env_local') {
          return { hostId: 'host_local', path: '/workspace/demo' };
        }
        throw new Error(`Unknown env ${environmentId}`);
      },
    },
    projects: {
      async get({ projectId }) {
        if (projectId === 'proj_demo') {
          return {
            sources: [
              { hostId: 'host_local', path: '/workspace/demo', isDefault: true },
              { hostId: 'host_remote', path: '/srv/demo', isDefault: false },
            ],
          };
        }
        throw new Error(`Unknown project ${projectId}`);
      },
    },
    threads: {
      async get({ threadId }) {
        return { environmentId: threadId === 'thr_with_env' ? 'env_local' : null };
      },
      async storageLocation({ threadId }) {
        return { hostId: 'host_local', storageRootPath: `/storage/${threadId}` };
      },
    },
  };
}

describe('listSiblingAudio', () => {
  test('resolves workspace environment files and returns workspace-relative sibling paths', async () => {
    const calls: Array<{ hostId: string; dir: string }> = [];
    const lister: HostAudioLister = async (hostId, dir) => {
      calls.push({ hostId, dir });
      return {
        items: [
          { name: 'a-take.mp3', sizeBytes: 100, mtimeMs: 10 },
          { name: 'b-take.wav', sizeBytes: 200, mtimeMs: 20 },
        ],
        truncated: false,
      };
    };

    const result = await listSiblingAudio(fakeSdk(), lister, {
      filePath: 'out/voice/a-take.mp3',
      source: {
        kind: 'workspace',
        environmentId: 'env_local',
        projectId: 'proj_demo',
        threadId: 'thr_1',
      },
    });

    expect(calls).toEqual([{ hostId: 'host_local', dir: '/workspace/demo/out/voice' }]);
    expect(result.directoryLabel).toBe('out/voice');
    expect(result.items.map((item) => item.path)).toEqual([
      'out/voice/a-take.mp3',
      'out/voice/b-take.wav',
    ]);
  });

  test('honours experimental_hostId for project-backed workspaces and rejects traversal', async () => {
    const calls: Array<{ hostId: string; dir: string }> = [];
    const lister: HostAudioLister = async (hostId, dir) => {
      calls.push({ hostId, dir });
      return { items: [{ name: 'clip.mp3', sizeBytes: 50, mtimeMs: 5 }], truncated: false };
    };

    const ok = await listSiblingAudio(fakeSdk(), lister, {
      filePath: 'clips/clip.mp3',
      source: {
        kind: 'workspace',
        environmentId: null,
        projectId: 'proj_demo',
        threadId: null,
        experimental_hostId: 'host_remote',
      },
    });
    expect(calls).toEqual([{ hostId: 'host_remote', dir: '/srv/demo/clips' }]);
    expect(ok.items[0]?.path).toBe('clips/clip.mp3');

    const escaped = await listSiblingAudio(fakeSdk(), lister, {
      filePath: '../../etc/a.mp3',
      source: {
        kind: 'workspace',
        environmentId: 'env_local',
        projectId: 'proj_demo',
        threadId: null,
      },
    });
    expect(escaped.items).toEqual([]);
  });

  test('resolves thread-storage and absolute host files', async () => {
    const calls: Array<{ hostId: string; dir: string }> = [];
    const lister: HostAudioLister = async (hostId, dir) => {
      calls.push({ hostId, dir });
      return { items: [{ name: 'sample.m4a', sizeBytes: 42, mtimeMs: 1 }], truncated: false };
    };

    const storage = await listSiblingAudio(fakeSdk(), lister, {
      filePath: 'voice/sample.m4a',
      source: {
        kind: 'thread-storage',
        environmentId: null,
        projectId: null,
        threadId: 'thr_storage',
      },
    });
    expect(calls[0]).toEqual({ hostId: 'host_local', dir: '/storage/thr_storage/voice' });
    expect(storage.directoryLabel).toBe('thread-storage/voice');
    expect(storage.items[0]?.path).toBe('voice/sample.m4a');

    const hostFile = await listSiblingAudio(fakeSdk(), lister, {
      filePath: '/tmp/audio/sample.m4a',
      source: {
        kind: 'host',
        environmentId: null,
        projectId: null,
        threadId: 'thr_with_env',
      },
    });
    expect(calls[1]).toEqual({ hostId: 'host_local', dir: '/tmp/audio' });
    expect(hostFile.directoryLabel).toBe('/tmp/audio');
    expect(hostFile.items[0]?.path).toBe('/tmp/audio/sample.m4a');
  });
});
