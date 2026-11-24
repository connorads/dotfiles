import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostContract } from './contracts.ts';
import { readAccount } from './src/accounts/account.ts';
import { checkLogin, classifyUsage, collectUsage, loginState } from './src/accounts/claude.ts';
import { listProfiles, releaseProfileSession, resolveProfile, rootPath, transferProfileSession } from './src/accounts/profiles.ts';
import { stageFork, sweepForkStages, unstageFork } from './src/accounts/fork-stage.ts';
import { materialise } from './src/accounts/materialise.ts';
import { adoptSession, isSessionId, locateSession, paneSession } from './src/accounts/import.ts';
import type { Usage } from './src/accounts/quota.ts';
import { collectAmpUsage } from './src/accounts/usage/amp.ts';
import { collectGrokUsage } from './src/accounts/usage/grok.ts';
import { collectAntigravityUsage } from './src/accounts/usage/antigravity.ts';
import { runCodexReset } from './src/accounts/usage/codex-reset-host.ts';
import { collect, readResetCredits } from './src/accounts/usage/reset-credits-host.ts';
import { collectClaudeResets, readClaudeResets } from './src/accounts/usage/claude-resets-host.ts';

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    profiles: input => listProfiles(input.root),
    validate: async (input, context) => {
      const selected = await resolveProfile(input.root, input.profileId);
      await checkLogin(input.executable, selected.configDir, context.signal);
      return { authenticated: true as const };
    },
    usage: async (input, context): Promise<Usage> => {
      try {
        const selected = await resolveProfile(input.root, input.profileId);
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
    materialise: async (input, context) => {
      const selected = await resolveProfile(input.root, input.profileId);
      if (!selected.configDir) return { materialised: false };
      const script = join(homedir(), '.config', 'zsh', 'functions', 'claude-profile-materialise');
      return { materialised: await materialise(script, selected.configDir, context.signal) };
    },
    transfer: input => transferProfileSession(input),
    release: input => releaseProfileSession(input),
    locate: async input => {
      const dirs = (await listProfiles(input.root)).map(value => ({ id: value.id, dir: value.configDir ?? join(homedir(), '.claude') }));
      return isSessionId(input.ref) ? locateSession(dirs, input.ref) : paneSession(dirs, input.ref);
    },
    adopt: async input => {
      const selected = await resolveProfile(input.root, input.profileId);
      await adoptSession(selected.configDir ?? join(homedir(), '.claude'), input.sourceSessionId, input.sessionId);
      return { adopted: true as const };
    },
    stageFork: async input => {
      const selected = await resolveProfile(input.root, input.profileId);
      if (!selected.configDir) throw new Error('A fork on Default needs no staging.');
      return stageFork(join(homedir(), '.claude'), selected.configDir, input.sessionId, input.forkThreadId);
    },
    unstageFork: input => unstageFork(join(homedir(), '.claude'), input.forkThreadId, input.forkSessionId),
    sweepForkStages: async input => ({ removed: await sweepForkStages(join(homedir(), '.claude'), input.maxAgeMs) }),
    ampUsage: (_input, { signal }) => collectAmpUsage(signal),
    grokUsage: (_input, { signal }) => collectGrokUsage({ signal }),
    antigravityUsage: (input, { signal }) => collectAntigravityUsage({ signal,
      command: input.accountId === 'default' ? ['agy'] : [join(homedir(), 'src/bb-plugins/claude-profiles/bin/agy-profile'), input.accountId] }),
    codexReset: (input, { signal }) => runCodexReset(input, signal),
    resetCredits: (input, { signal }) => readResetCredits(homedir(), input.refresh, () => collect(homedir(), signal)),
    claudeResets: async (input, { signal }) => {
      await resolveProfile(input.root, input.profileId);
      if (input.profileId !== 'default' && rootPath(input.root) !== join(homedir(), '.claude-profiles/code'))
        return { status: 'unavailable' as const, message: 'Reset collection requires the standard Claude profile root.' };
      return readClaudeResets(homedir(), input.profileId, input.refresh, () => collectClaudeResets(homedir(), input.profileId, signal));
    },
  },
});
