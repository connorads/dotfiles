import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { AmpReading } from './amp-reading.ts';

export function collectAmpUsage(signal: AbortSignal, command = 'amp'): Promise<AmpReading> {
  const path = [join(homedir(), '.local/share/mise/shims'), process.env.PATH ?? '/usr/bin:/bin'].join(':');
  return new Promise(resolve => {
    execFile(command, ['usage'], { signal, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      env: { ...process.env, PATH: path, NO_COLOR: '1' } }, (error, stdout, stderr) => {
      if (error) {
        const message = error.code === 'ENOENT' ? 'Amp CLI is not installed on this machine.'
          : signal.aborted || error.killed ? 'Amp usage collection timed out or was cancelled.'
          : /must be logged in|amp login/i.test(stderr) ? 'Sign in with amp login on this machine.'
          : 'Amp usage could not be collected on this machine.';
        resolve({ status: 'unavailable', message });
        return;
      }
      const text = stripVTControlCharacters(stdout).trim();
      resolve(text ? { status: 'ok', text, observedAt: Date.now() }
        : { status: 'unavailable', message: 'Amp returned no usage reading.' });
    });
  });
}
