import { lstat, mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { parseRepository } from './repositories.ts';
import type { Run } from './process.ts';

export type Preparation = { ok: true; path: string; reused: boolean } | { ok: false; message: string };
interface CheckoutOptions { run: Run; home?: string }

export function createCheckout(options: CheckoutOptions) {
  const home = options.home ?? homedir();
  const pending = new Map<string, Promise<Preparation>>();
  const destinationPath = (input: string): string | null => {
    const value = input.trim();
    const expanded = value === '~' ? home : value.startsWith('~/') ? resolve(home, value.slice(2)) : value;
    if (!isAbsolute(expanded)) return null;
    const path = resolve(expanded);
    return path === resolve(home) || path === parse(path).root ? null : path;
  };

  async function inspect(repository: string, destination: string, signal?: AbortSignal): Promise<Preparation> {
    const identity = parseRepository(repository);
    const path = destinationPath(destination);
    if (!identity) return { ok: false, message: 'Enter a GitHub owner/repository or clone URL.' };
    if (!path) return { ok: false, message: 'Choose an absolute repository folder, such as ~/git/atlas.' };
    try {
      const target = await realpath(path);
      if (target === await realpath(home).catch(() => resolve(home)) || target === parse(target).root) return { ok: false, message: 'Choose a repository folder rather than your home folder or filesystem root.' };
      const topLevel = await options.run('git', ['-C', path, 'rev-parse', '--show-toplevel'], { signal });
      if (topLevel.code !== 0 || await realpath(topLevel.stdout.trim()).catch(() => '') !== target) {
        return { ok: false, message: 'That destination exists but is not a repository checkout. Choose another folder.' };
      }
      const origin = await options.run('git', ['-C', path, 'remote', 'get-url', 'origin'], { signal });
      if (origin.code !== 0 || parseRepository(origin.stdout.trim()) !== identity) {
        return { ok: false, message: 'That destination contains a different repository. Choose another folder.' };
      }
      return { ok: true, path: target, reused: true };
    } catch {
      return { ok: false, message: 'The checkout is missing or unreadable. Choose another folder or clone it again.' };
    }
  }

  async function prepareOnce(repository: string, path: string, signal?: AbortSignal): Promise<Preparation> {
    const identity = parseRepository(repository);
    if (!identity) return { ok: false, message: 'Enter a GitHub owner/repository or clone URL.' };
    try {
      const exists = await lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (exists) return inspect(identity, path, signal);
      if (signal?.aborted) return { ok: false, message: 'Clone cancelled.' };
      await mkdir(dirname(path), { recursive: true });
      const cloned = await options.run('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--', `git@github.com:${identity}.git`, path], { signal, timeoutMs: 600_000, maxBytes: 262_144 });
      if (cloned.code !== 0) return { ok: false, message: cloned.stderr.trim() || 'Clone failed. Check repository access on this Mac and retry.' };
      const inspected = await inspect(identity, path, signal);
      return inspected.ok ? { ...inspected, reused: false } : inspected;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Cannot prepare that destination.' };
    }
  }

  async function prepare(repository: string, destination: string, signal?: AbortSignal): Promise<Preparation> {
    const path = destinationPath(destination);
    if (!path) return { ok: false, message: 'Choose an absolute repository folder, such as ~/git/atlas.' };
    const key = process.platform === 'darwin' ? path.toLowerCase() : path;
    const current = pending.get(key);
    if (current) { await current; return inspect(repository, path, signal); }
    const operation = prepareOnce(repository, path, signal);
    pending.set(key, operation);
    try { return await operation; }
    finally { if (pending.get(key) === operation) pending.delete(key); }
  }

  return { inspect, prepare };
}
