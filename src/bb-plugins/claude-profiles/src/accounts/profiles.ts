import { homedir } from 'node:os';
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { Profile } from '../../contracts.ts';
import { hasSession, releaseSession, transferSession, type Transfer } from './handover.ts';

export function rootPath(root: string, home = homedir()) {
  const path = root.startsWith('~/') ? join(home, root.slice(2)) : root;
  if (!isAbsolute(path)) throw new Error('Profile root must be an absolute path or start with ~/.');
  return path;
}

export async function listProfiles(root: string, home = homedir()): Promise<Profile[]> {
  const directory = rootPath(root, home);
  const result: Profile[] = [{ id: 'default', label: 'Default', configDir: null }];
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && entry.name !== 'default' && !entry.name.startsWith('.')) {
      result.push({ id: entry.name, label: entry.name, configDir: join(directory, entry.name) });
    }
  }
  return result;
}

export async function resolveProfile(root: string, id: string, home = homedir()) {
  const selected = (await listProfiles(root, home)).find(value => value.id === id);
  if (!selected) throw new Error('Profile no longer exists. Refresh the list.');
  const stat = await lstat(selected.configDir ?? join(home, '.claude'));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Profile directory must be a real directory.');
  return selected;
}

function namedSourceUnderRoot(root: string, sourceDir: string | null, home: string): { name: string; resolved: string } | null {
  if (!sourceDir) return null;
  const base = resolve(rootPath(root, home));
  const resolved = resolve(sourceDir);
  const name = basename(resolved);
  if (dirname(resolved) !== base || !name || name === 'default' || name.startsWith('.')) return null;
  return { name, resolved };
}

type HandoverResolution =
  | { kind: 'live'; source: string; target: string }
  | { kind: 'missing'; name: string; resolved: string; target: string };

async function resolveHandover(input: { root: string; sourceDir: string | null; profileId: string }, home: string): Promise<HandoverResolution> {
  const selected = await resolveProfile(input.root, input.profileId, home);
  const target = selected.configDir ?? join(home, '.claude');
  const source = (await listProfiles(input.root, home)).find(value => value.configDir === input.sourceDir);
  if (source) return { kind: 'live', source: source.configDir ?? join(home, '.claude'), target };
  const named = namedSourceUnderRoot(input.root, input.sourceDir, home);
  if (!named) throw new Error('Current profile is outside the configured profile root. Set the correct root before switching.');
  const stat = await lstat(named.resolved).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat) throw new Error('Current profile directory must be a real directory.');
  return { kind: 'missing', name: named.name, resolved: named.resolved, target };
}

export async function transferProfileSession(
  input: { root: string; sourceDir: string | null; profileId: string; sessionId: string; replace?: boolean; allowMissing?: boolean },
  home = homedir(),
): Promise<Transfer> {
  const resolved = await resolveHandover(input, home);
  if (resolved.kind === 'live') {
    return transferSession(resolved.source, resolved.target, input.sessionId, { replace: input.replace, allowMissing: input.allowMissing });
  }
  // A deleted source directory has no history left to copy; allow rebinding when the target already holds it or rebinding is explicit.
  if (await hasSession(resolved.target, input.sessionId) || input.allowMissing) return { status: 'copied' };
  throw new Error(
    `Source profile "${resolved.name}" no longer exists on disk, so its session history cannot be transferred. Restore it to ${resolved.resolved} to move this conversation.`,
  );
}

export async function releaseProfileSession(
  input: { root: string; sourceDir: string | null; profileId: string; sessionId: string },
  home = homedir(),
): Promise<{ released: boolean }> {
  const resolved = await resolveHandover(input, home);
  if (resolved.kind === 'missing') return { released: false };
  return releaseSession(resolved.source, resolved.target, input.sessionId);
}
