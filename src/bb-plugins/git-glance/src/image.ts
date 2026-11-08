import { execFile } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DiffSource } from '../contracts.ts';
import type { Repo } from './repo.ts';
import { gitEnv } from './git-env.ts';

// Two base64-encoded sides stay below the host RPC's 8 MiB result limit.
const limit = 2 * 1024 * 1024;
const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' };

async function blob(repo: Repo, revision: string, path: string): Promise<Buffer | null> {
  return new Promise((done, reject) => {
    execFile('git', [...repo.select, 'show', `${revision}:${path}`],
      { cwd: repo.cwd, encoding: 'buffer', maxBuffer: limit, timeout: 10_000, env: gitEnv({ GIT_OPTIONAL_LOCKS: '0' }) },
      (error, stdout) => {
        if (!error) done(stdout);
        else if (error.code === 128) done(null);
        else reject(new Error(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'Image exceeds the 2 MiB preview limit.' : error.message));
      });
  });
}

async function working(repo: Repo, path: string): Promise<Buffer | null> {
  const target = resolve(repo.cwd, path);
  try {
    if (await realpath(target) !== target) throw new Error('Image previews do not follow symbolic links.');
    const file = await open(target, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Image preview requires a regular file.');
      const bytes = Buffer.alloc(limit + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > limit) throw new Error('Image exceeds the 2 MiB preview limit.');
      return bytes.subarray(0, bytesRead);
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function imagePreview(repo: Repo, input: { path: string; origPath: string | null; source: DiffSource },
  base: (sha: string) => Promise<string>) {
  const extension = input.path.split('.').pop()?.toLowerCase() ?? '';
  const type = Object.hasOwn(types, extension) ? types[extension] : undefined;
  if (!type) return undefined;
  const oldPath = input.origPath ?? input.path;
  if (oldPath.startsWith('/') || oldPath.split('/').includes('..')) throw new Error('Invalid image path.');
  const { source } = input;
  const before = source.kind === 'commit' ? await blob(repo, await base(source.sha), oldPath)
    : source.area === 'untracked' ? null : await blob(repo, source.area === 'staged' ? 'HEAD' : '', oldPath);
  const after = source.kind === 'commit' ? await blob(repo, source.sha, input.path)
    : source.area === 'staged' ? await blob(repo, '', input.path) : await working(repo, input.path);
  const uri = (bytes: Buffer | null) => bytes === null ? null : `data:${type};base64,${bytes.toString('base64')}`;
  return { before: uri(before), after: uri(after) };
}
