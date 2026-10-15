import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { homedir, tmpdir } from 'node:os';
import { readdir, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { hostContract, type Profile } from './contracts.ts';
import { readAccount } from './src/accounts/account.ts';
import { checkLogin, classifyUsage, collectUsage, loginState } from './src/accounts/claude.ts';
import { transferSession } from './src/accounts/handover.ts';
import { adoptSession, isSessionId, locateSession, paneSession } from './src/accounts/import.ts';
import type { Usage } from './src/accounts/quota.ts';
import { collectAmpUsage } from './src/accounts/usage/amp.ts';
import { collectGrokUsage } from './src/accounts/usage/grok.ts';
import { collect, readResetCredits } from './src/accounts/usage/reset-credits-host.ts';

function rootPath(root: string) {
  const path = root.startsWith('~/') ? join(homedir(), root.slice(2)) : root;
  if (!isAbsolute(path)) throw new Error('Profile root must be an absolute path or start with ~/.');
  return path;
}
async function profiles(root: string): Promise<Profile[]> {
  const directory = rootPath(root);
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
async function profile(root: string, id: string) {
  const selected = (await profiles(root)).find(value => value.id === id);
  if (!selected) throw new Error('Profile no longer exists. Refresh the list.');
  const stat = await lstat(selected.configDir ?? join(homedir(), '.claude'));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Profile directory must be a real directory.');
  return selected;
}
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    profiles: input => profiles(input.root),
    validate: async (input, context) => {
      const selected = await profile(input.root, input.profileId);
      await checkLogin(input.executable, selected.configDir, context.signal);
      return { authenticated: true as const };
    },
    usage: async (input, context): Promise<Usage> => {
      try {
        const selected = await profile(input.root, input.profileId);
        const [collected, account] = await Promise.all([
          collectUsage(input.executable, selected.configDir, tmpdir(), context.signal).catch((error): Usage => ({ status: 'error',
            windows: [], observedAt: null, message: error instanceof Error ? error.message : 'Claude quota request failed.' })),
          readAccount(selected.configDir ? join(selected.configDir, '.claude.json') : join(homedir(), '.claude.json'))]);
        // Windows prove a login, so only an empty or failed reading pays for the login check.
        const ambiguous = collected.status === 'error' || (collected.status === 'ok' && collected.windows.length === 0);
        const usage = ambiguous ? classifyUsage(collected, await loginState(input.executable, selected.configDir, context.signal)) : collected;
        return usage.status === 'ok' ? { ...usage, account } : usage;
      }
      catch (error) { return { status: 'error', windows: [], observedAt: null,
        message: error instanceof Error ? error.message : 'Claude quota request failed.' }; }
    },
    transfer: async input => {
      const selected = await profile(input.root, input.profileId);
      const source = (await profiles(input.root)).find(value => value.configDir === input.sourceDir);
      if (!source) throw new Error('Current profile is outside the configured profile root. Set the correct root before switching.');
      await transferSession(source.configDir ?? join(homedir(), '.claude'), selected.configDir ?? join(homedir(), '.claude'), input.sessionId);
      return { copied: true };
    },
    locate: async input => {
      const dirs = (await profiles(input.root)).map(value => ({ id: value.id, dir: value.configDir ?? join(homedir(), '.claude') }));
      return isSessionId(input.ref) ? locateSession(dirs, input.ref) : paneSession(dirs, input.ref);
    },
    adopt: async input => {
      const selected = await profile(input.root, input.profileId);
      await adoptSession(selected.configDir ?? join(homedir(), '.claude'), input.sourceSessionId, input.sessionId);
      return { adopted: true as const };
    },
    ampUsage: (_input, { signal }) => collectAmpUsage(signal),
    grokUsage: (_input, { signal }) => collectGrokUsage({ signal }),
    resetCredits: (input, { signal }) => readResetCredits(homedir(), input.refresh, () => collect(homedir(), signal)),
  },
});
