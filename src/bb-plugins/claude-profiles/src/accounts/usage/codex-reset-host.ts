import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { resetStateSchema, type ResetAction } from './codex-reset.ts';

const run = promisify(execFile);

export async function runCodexReset(input: { command: 'check' | 'status' } | { command: 'set'; action: ResetAction }, signal: AbortSignal) {
  const home = homedir();
  const path = [join(home, '.local/bin'), join(home, '.local/share/mise/shims'), join(home, '.nix-profile/bin'),
    `/etc/profiles/per-user/${basename(home)}/bin`, '/run/current-system/sw/bin', process.env.PATH ?? '/usr/bin:/bin'].join(':');
  const args = input.command !== 'set' ? [input.command] : input.action.mode === 'off' ? ['off']
    : ['arm', input.action.mode, '--trigger', String(input.action.trigger)];
  const cli = join(home, 'src/bb-plugins/claude-profiles/bin/codex-reset');
  try {
    const { stdout } = await run(cli, args, { signal, cwd: home, timeout: 50_000, maxBuffer: 8 * 1024,
      env: { ...process.env, PATH: path } });
    return resetStateSchema.parse(JSON.parse(stdout));
  } catch {
    throw new Error('Could not run codex-reset on this machine. Check the Codex login and dotfiles, or try again shortly.');
  }
}
