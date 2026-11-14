import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** Login-shell variables Codex needs. None holds a credential. */
const NAMES = [
  'PATH', 'EDITOR', 'PAGER', 'TERMINFO_DIRS', 'XDG_CONFIG_DIRS', 'XDG_DATA_DIRS',
  'NIX_PATH', 'NIX_PROFILES', 'NIX_SSL_CERT_FILE', 'NIX_USER_PROFILE_DIR',
  // Tells nix-darwin's zshenv the setup above already ran, so it does not reset PATH.
  '__NIX_DARWIN_SET_ENVIRONMENT_DONE',
];

export interface Entry { name: string; value: string; reason: string }

/**
 * Keeps the allowed variables and orders PATH so user wrappers come first,
 * then mise shims. Shims pick each directory's mise tool versions, which a
 * global mise activation would otherwise shadow.
 */
export function shape(login: Record<string, string>, home: string): Entry[] {
  const localBin = join(home, '.local', 'bin');
  const shims = join(login['MISE_DATA_DIR'] ?? join(home, '.local', 'share', 'mise'), 'shims');
  const entries: Entry[] = [];
  for (const name of NAMES) {
    const raw = login[name];
    if (raw === undefined || raw === '') continue;
    const value = name === 'PATH' ? orderPath(raw, [localBin, shims]) : raw;
    entries.push({ name, value, reason: 'Nix Mise Environment: login-shell Nix setup and mise shims' });
  }
  return entries;
}

function orderPath(path: string, first: string[]): string {
  const rest = path.split(':').filter(dir => dir !== '' && !first.includes(dir));
  return [...new Set([...first, ...rest])].join(':');
}

/** Reads a clean login shell's environment. A login shell skips .zshrc, so no interactive setup runs. */
export function readLoginEnvironment(home: string, user: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    execFile('/bin/zsh', ['-l', '-c', 'env -0'], {
      env: { HOME: home, USER: user, LOGNAME: user, SHELL: '/bin/zsh' },
      cwd: home, timeout: 4000, maxBuffer: 1 << 20,
    }, (error, stdout) => {
      if (error) { reject(error); return; }
      const values: Record<string, string> = {};
      for (const pair of stdout.split('\0')) {
        const at = pair.indexOf('=');
        if (at > 0) values[pair.slice(0, at)] = pair.slice(at + 1);
      }
      resolve(values);
    });
  });
}
