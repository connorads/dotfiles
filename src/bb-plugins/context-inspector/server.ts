import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { rpcContract, type OwnerResult } from './contracts';

const maximumBytes = 256 * 1024;

/** Internal filesystem seam. RPC callers cannot supply a home or path. */
export async function readOwner(home: string, hostId: string): Promise<OwnerResult> {
  const path = join(home, '.config', 'bb', 'plugin-config.json');
  try {
    // Refuse every symlink before opening the allowlisted file, including parents.
    for (let current = path; current !== parse(current).root; current = dirname(current)) {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) return { kind: 'unavailable', reason: 'Owner path contains a symlink.' };
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maximumBytes) return { kind: 'unavailable', reason: 'Owner must be a regular file below 256 KiB.' };
      const bytes = Buffer.alloc(maximumBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maximumBytes) return { kind: 'unavailable', reason: 'Owner exceeds 256 KiB.' };
      const content = bytes.subarray(0, length);
      return { kind: 'available', hostId, text: content.toString('utf8') };
    } finally { await file.close(); }
  } catch {
    return { kind: 'unavailable', reason: 'Allowlisted owner file is missing or unreadable.' };
  }
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async owner({ threadId }): Promise<OwnerResult> {
      const primary = (await bb.sdk.system.config()).primaryHostId;
      if (!primary) return { kind: 'unavailable', reason: 'Server configuration host is unavailable.' };
      const thread = await bb.sdk.threads.get({ threadId });
      if (!thread.environmentId) return { kind: 'unavailable', reason: 'Thread has no workspace host.' };
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      if (environment.hostId !== primary) return { kind: 'unavailable', reason: 'Owner preview requires the workspace and configuration on the same server host.' };
      return readOwner(homedir(), primary);
    },
  });
}
