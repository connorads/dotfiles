import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseResetCredits, type ResetCredits } from './reset-credits.ts';

/** The usage collector owns credentials, backoff and locking. This adapter reads only its usage cache. */
export async function readResetCredits(home: string, refresh: boolean, collect: () => Promise<boolean>): Promise<ResetCredits> {
  const path = join(home, '.cache/codex-usage.json');
  const before = await stat(path).catch(() => null);
  const needsRefresh = refresh || before === null || Date.now() - before.mtimeMs >= 300_000;
  const collected = !needsRefresh || await collect();
  try {
    const file = await stat(path);
    if (file.size > 1024 * 1024) return { status: 'unavailable', message: 'Usage cache exceeds the reading limit.' };
    const reading = parseResetCredits(JSON.parse(await readFile(path, 'utf8')), file.mtimeMs);
    if (reading.status !== 'ok' || !needsRefresh) return reading;
    const message = !collected ? 'Reset-credit refresh failed. Showing the cached reading.'
      : before?.mtimeMs === file.mtimeMs ? 'Collector kept the cached reading. Refresh may be paused.' : null;
    return message ? { ...reading, message } : reading;
  } catch {
    return { status: 'unavailable', message: 'No readable usage cache. Refresh uses the installed codex-usage collector.' };
  }
}

export function collect(home: string, signal: AbortSignal): Promise<boolean> {
  const path = [join(home, '.local/bin'), join(home, '.nix-profile/bin'),
    `/etc/profiles/per-user/${basename(home)}/bin`, '/run/current-system/sw/bin', process.env.PATH ?? '/usr/bin:/bin'].join(':');
  return new Promise(resolve => {
    execFile('zsh', [join(home, '.config/zsh/functions/codex-usage')],
      { signal, timeout: 25_000, maxBuffer: 64 * 1024, env: { ...process.env, PATH: path } },
      error => resolve(error === null));
  });
}
