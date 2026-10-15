import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { authOverrides } from '../claude.ts';
import { decodeResourceId } from '../usage-source.ts';
import type { Profile } from '../../../contracts.ts';
import type { QuotaConfig } from '../quota-cache.ts';

interface LoginPorts {
  terminals: Pick<BbPluginApi['sdk']['terminals'], 'create' | 'get'>;
  config(): Promise<QuotaConfig>;
  hosts(): Promise<{ id: string; status: string }[]>;
  profiles(hostId: string, root: string): Promise<Profile[]>;
}

export function createLogin(ports: LoginPorts) {
  const terminals = new Map<string, string>();
  const pending = new Map<string, Promise<{ terminalId: string }>>();
  return async function login(hostId: string, accountId: string): Promise<{ terminalId: string }> {
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
    } else throw new Error('Sign-in is available for Claude accounts only.');
    if (!(await ports.hosts()).some(host => host.id === hostId && host.status === 'connected'))
      throw new Error('Account machine is offline. Connect it before signing in.');
    const profile = (await ports.profiles(hostId, config.profileRoot)).find(value => value.id === profileId);
    if (!profile) throw new Error('Profile no longer exists. Refresh usage before signing in.');
    const key = JSON.stringify([hostId, profile.configDir, config.executable]);
    const running = pending.get(key);
    if (running) return running;
    const request = (async () => {
      const existingId = terminals.get(key);
      if (existingId) {
        const existing = await ports.terminals.get({ terminalId: existingId }).catch(() => null);
        if (existing?.status === 'starting' || existing?.status === 'running') return { terminalId: existing.id };
      }
      // argv preserves profile paths literally; env removes credentials inherited from the host shell.
      const argv = ['env', ...[...authOverrides, 'CLAUDECODE', 'CLAUDE_CONFIG_DIR'].flatMap(name => ['-u', name]),
        ...(profile.configDir ? [`CLAUDE_CONFIG_DIR=${profile.configDir}`] : []), config.executable, 'auth', 'login'];
      const terminal = await ports.terminals.create({ scope: { kind: 'host_path', hostId, cwd: null },
        title: `Claude sign-in · ${profile.label}`, cols: 100, rows: 30, start: { mode: 'argv', argv } });
      terminals.set(key, terminal.id);
      return { terminalId: terminal.id };
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
