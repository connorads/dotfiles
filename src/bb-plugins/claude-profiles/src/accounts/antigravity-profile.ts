import { mkdir, lstat, chmod, writeFile, utimes, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Isolation relies on undocumented agy storage behaviour, so only a release checked
// by hand may launch. The agy-pin-lockstep hk step holds mise's pin to this value.
export const verifiedAgyVersion = '1.5.9';
export function agyVersionProblem(installed: string, pinned: string) {
  if (installed === verifiedAgyVersion) return undefined;
  if (pinned === verifiedAgyVersion)
    return `agy ${installed} replaced the pinned ${pinned} binary. Reinstall it with: mise install --force --locked agy`;
  return `Isolated authentication needs verification with agy ${installed}. Tested version: ${verifiedAgyVersion}.`;
}
const accountName = /^[a-z][a-z0-9-]{0,31}$/u;
export function antigravityProfilePath(home: string, id: string) {
  if (!accountName.test(id) || id === 'default') throw new Error('Use a lowercase account name other than default.');
  return join(home, '.local/share/agy-profiles', id);
}
async function directory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Account directories must be real directories.');
}
export async function prepareAntigravityProfile(home: string, id: string) {
  const profile = antigravityProfilePath(home, id);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await directory(profile);
  await chmod(profile, 0o700);
  const cache = join(profile, 'home/.gemini/antigravity-cli/cache');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await directory(join(profile, 'home'));
  const marker = join(cache, 'antigravity-keyring-unavailable');
  await writeFile(marker, 'file-session\n', { mode: 0o600 });
  // The native fallback expires its negative Keychain cache by modification time.
  const future = new Date(Date.now() + 10 * 365 * 86400_000);
  await utimes(marker, future, future);
  return profile;
}

export async function antigravityLaunch(home: string, id: string, executable: string) {
  const profile = antigravityProfilePath(home, id);
  try { await directory(profile); await directory(join(profile, 'home')); }
  catch { throw new Error(`Create this profile first: agy-profile create ${id}`); }
  await prepareAntigravityProfile(home, id);
  const root = join(home, '.local/share/agy-profiles');
  const others = (await readdir(root)).filter(name => name !== id).map(name => join(root, name));
  const blocked = [join(home, 'Library/Keychains'), '/Library/Keychains', join(home, '.gemini'), ...others];
  const policy = join(profile, 'keychain-block.sb');
  await writeFile(policy, `(version 1)\n(allow default)\n`
    + `(deny process-exec (literal "/usr/bin/security"))\n`
    + `(deny file-read* file-write* ${blocked.map(path => `(subpath ${JSON.stringify(path)})`).join(' ')})\n`
    + `(deny mach-lookup (global-name "com.apple.securityd"))\n`, { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(profile, 'home'), WSL_INTEROP: '1', AGY_SWAP_SKIP_SYNC: '1' };
  for (const key of ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'])
    delete env[key];
  return { command: '/usr/bin/sandbox-exec', args: ['-f', policy, executable], env };
}
