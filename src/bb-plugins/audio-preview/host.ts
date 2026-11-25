import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract, type HostAudioEntry } from './contracts';
import { isAudioFilename } from './src/audio';

export const MAX_AUDIO_ENTRIES = 500;

const IGNORED_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);

export async function listAudioInDirectory(
  dir: string,
  limit = MAX_AUDIO_ENTRIES,
): Promise<{ items: HostAudioEntry[]; truncated: boolean }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && IGNORED_ERROR_CODES.has(String(error.code))) {
      return { items: [], truncated: false };
    }
    throw error;
  }

  const items: HostAudioEntry[] = [];
  let truncated = false;

  for (const entry of entries) {
    if (!isAudioFilename(entry.name)) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    if (items.length >= limit) {
      truncated = true;
      break;
    }

    try {
      const info = await stat(join(dir, entry.name));
      if (!info.isFile()) continue;
      items.push({
        name: entry.name,
        sizeBytes: info.size,
        mtimeMs: Number.isFinite(info.mtimeMs) ? info.mtimeMs : null,
      });
    } catch {
      // Skip dangling symlinks or entries that vanish mid-read.
    }
  }

  return { items, truncated };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    listAudio: ({ dir }) => listAudioInDirectory(dir),
  },
});
