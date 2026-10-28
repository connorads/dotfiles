import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { authOverrides } from '../claude.ts';
import { decodeResourceId } from '../usage-source.ts';
import type { LoginMethod } from './contract.ts';
import type { Profile } from '../../../contracts.ts';
import type { QuotaConfig } from '../quota-cache.ts';

interface LoginPorts {
  terminals: Pick<BbPluginApi['sdk']['terminals'], 'create' | 'get' | 'close'>;
  config(): Promise<QuotaConfig>;
  hosts(): Promise<{ id: string; status: string }[]>;
  profiles(hostId: string, root: string): Promise<Profile[]>;
}

export function createLogin(ports: LoginPorts) {
  const terminals = new Map<string, { terminalId: string; argv: string }>();
  const pending = new Map<string, Promise<{ terminalId: string }>>();
  function open(key: string, title: string, hostId: string, argv: string[]) {
    const running = pending.get(key);
    if (running) return running;
    const request = (async () => {
      const previous = terminals.get(key);
      if (previous) {
        const existing = await ports.terminals.get({ terminalId: previous.terminalId }).catch(() => null);
        if (existing?.status === 'starting' || existing?.status === 'running') {
          if (previous.argv === JSON.stringify(argv)) return { terminalId: existing.id };
          // Both logins write the same credentials, so a changed command replaces the running one.
          await ports.terminals.close({ terminalId: existing.id, mode: 'force' });
        }
      }
      const terminal = await ports.terminals.create({ scope: { kind: 'host_path', hostId, cwd: null },
        title, cols: 100, rows: 30, start: { mode: 'argv', argv } });
      terminals.set(key, { terminalId: terminal.id, argv: JSON.stringify(argv) });
      return { terminalId: terminal.id };
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }
  async function connected(hostId: string) {
    if (!(await ports.hosts()).some(host => host.id === hostId && host.status === 'connected'))
      throw new Error('Account machine is offline. Connect it before signing in.');
  }
  return async function login(hostId: string, accountId: string, method: LoginMethod = 'device'): Promise<{ terminalId: string }> {
    if (accountId.startsWith('provider-opencode:')) {
      const [accountHost] = z.tuple([z.string(), z.literal('opencode')])
        .parse(JSON.parse(accountId.slice('provider-opencode:'.length)));
      if (accountHost !== hostId) throw new Error('Account belongs to another machine.');
      await connected(hostId);
      return open(JSON.stringify([hostId, 'opencode']), 'OpenCode sign-in', hostId, ['opencode', 'auth', 'login']);
    }
    if (accountId.startsWith('provider-codex:')) {
      const [accountHost] = z.tuple([z.string(), z.literal('codex')])
        .parse(JSON.parse(accountId.slice('provider-codex:'.length)));
      if (accountHost !== hostId) throw new Error('Account belongs to another machine.');
      await connected(hostId);
      // The browser callback reaches only a browser on the account machine; a device code works from any device.
      return open(JSON.stringify([hostId, 'codex']), 'Codex sign-in', hostId,
        method === 'browser' ? ['codex', 'login'] : ['codex', 'login', '--device-auth']);
    }
    const config = await ports.config();
    let profileId: string;
    if (accountId.startsWith('claude-profiles:')) {
      const [accountHost, root, id] = decodeResourceId(accountId.slice('claude-profiles:'.length));
      if (accountHost !== hostId || root !== config.profileRoot) throw new Error('Account changed. Refresh usage before signing in.');
      profileId = id;
    } else if (accountId.startsWith('provider-claude-code:')) {
      const [accountHost] = z.tuple([z.string(), z.literal('claude-code')])
        .parse(JSON.parse(accountId.slice('provider-claude-code:'.length)));
      if (accountHost !== hostId) throw new Error('Account belongs to another machine.');
      profileId = 'default';
    } else throw new Error('Sign-in is available for Claude, Codex and OpenCode accounts only.');
    await connected(hostId);
    const profile = (await ports.profiles(hostId, config.profileRoot)).find(value => value.id === profileId);
    if (!profile) throw new Error('Profile no longer exists. Refresh usage before signing in.');
    // argv preserves profile paths literally; env removes credentials inherited from the host shell.
    const argv = ['env', ...[...authOverrides, 'CLAUDECODE', 'CLAUDE_CONFIG_DIR'].flatMap(name => ['-u', name]),
      ...(profile.configDir ? [`CLAUDE_CONFIG_DIR=${profile.configDir}`] : []), config.executable, 'auth', 'login'];
    return open(JSON.stringify([hostId, profile.configDir, config.executable]), `Claude sign-in · ${profile.label}`, hostId, argv);
  };
}
