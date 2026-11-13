import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseClaudeResets, type ClaudeResets } from './claude-resets.ts';

/** The shell collector owns authentication, locking and backoff, as it does for Codex. */
export async function readClaudeResets(home: string, profileId: string, refresh: boolean,
  collect: () => Promise<boolean>): Promise<ClaudeResets> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(profileId)) return { status: 'unavailable', message: 'Unsupported Claude profile name.' };
  const path = join(home, '.cache', profileId === 'default' ? 'claude-usage.json' : `claude-usage-${profileId}.json`);
  const before = await stat(path).catch(() => null);
  const needsRefresh = refresh || before === null || Date.now() - before.mtimeMs >= 300_000;
  const collected = !needsRefresh || await collect();
  try {
    const file = await stat(path);
    if (file.size > 1024 * 1024) return { status: 'unavailable', message: 'Claude usage cache exceeds the reading limit.' };
    const reading = parseClaudeResets(JSON.parse(await readFile(path, 'utf8')), file.mtimeMs);
    if (reading.status !== 'ok' || !needsRefresh) return reading;
    const message = !collected ? 'Reset refresh failed. Showing the cached reading.'
      : before?.mtimeMs === file.mtimeMs && Date.now() - file.mtimeMs >= 300_000
        ? 'Collector kept the cached reading. Refresh may be paused.' : null;
    return message ? { ...reading, message } : reading;
  } catch {
    return { status: 'unavailable', message: 'No readable Claude usage cache. Refresh uses the installed claude-usage collector.' };
  }
}

export function collectClaudeResets(home: string, profileId: string, signal: AbortSignal): Promise<boolean> {
  const path = [join(home, '.local/bin'), join(home, '.local/share/mise/shims'), join(home, '.nix-profile/bin'),
    `/etc/profiles/per-user/${basename(home)}/bin`, '/run/current-system/sw/bin', process.env.PATH ?? '/usr/bin:/bin'].join(':');
  return new Promise(resolve => {
    execFile('zsh', ['-f', join(home, '.config/zsh/functions/claude-usage'), ...(profileId === 'default' ? [] : ['--profile', profileId])],
      { signal, timeout: 25_000, maxBuffer: 64 * 1024, env: { ...process.env, PATH: path } }, error => resolve(error === null));
  });
}
