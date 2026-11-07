import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { desktopApp, fromInspection, unavailable, type Snapshot } from './model';

/** Paths and arguments are local constants. RPC callers cannot select an executable or target. */
export async function inspectDesktop(signal?: AbortSignal): Promise<Snapshot> {
  const observedAt = new Date().toISOString();
  if (process.platform !== 'darwin') return unavailable('Desktop inspection requires macOS.', observedAt);
  const manager = join(homedir(), 'src', 'bb-plugins', 'workflows-patch', 'scripts', 'bb_patch.py');
  return new Promise(resolve => {
    execFile('/usr/bin/python3', ['-B', manager, 'inspect', '--app', desktopApp, '--require-set', 'session-options-plus-activity', '--json'],
      { timeout: 12_000, maxBuffer: 256 * 1024, signal, env: { HOME: homedir(), PATH: '/usr/bin:/bin', LC_ALL: 'C' } },
      (error, stdout, stderr) => {
        const exitCode = error ? typeof error.code === 'number' ? error.code : null : 0;
        if (exitCode === null) { resolve(unavailable('The patch inspector could not finish. Check its installation and try Refresh.', observedAt)); return; }
        try { resolve(fromInspection(JSON.parse(stdout.trim() || stderr.trim()), exitCode, observedAt)); }
        catch { resolve(unavailable('The patch inspector did not return a readable report.', observedAt)); }
      });
  });
}
