import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';

/**
 * Runs the dotfiles materialiser that derives a profile's settings, memory, skills and commands from ~/.claude.
 * CLAUDE_CONFIG_DIR hides the shared user config, so a BB launch without this misses what a `ccp` launch inherits.
 * False when the host has no materialiser: the launch goes ahead on whatever the profile already holds.
 */
export async function materialise(script: string, configDir: string, signal?: AbortSignal): Promise<boolean> {
  try { await access(script, constants.X_OK); } catch { return false; }
  await promisify(execFile)(script, [configDir], { signal, timeout: 3000, maxBuffer: 65536 });
  return true;
}
