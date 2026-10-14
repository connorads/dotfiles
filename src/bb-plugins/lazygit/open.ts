import type { BbPluginApi } from '@get-bb/plugin-sdk';

type Terminals = Pick<BbPluginApi['sdk']['terminals'], 'list' | 'create'>;

export function makeOpenLazygit(terminals: Terminals) {
  const pending = new Map<string, Promise<string>>();
  async function launch(threadId: string) {
    const scope = { kind: 'thread', threadId } as const;
    const { sessions } = await terminals.list({ scope });
    const existing = sessions.find(s => s.title === 'Lazygit' && (s.status === 'running' || s.status === 'starting'));
    if (existing) return existing.id;
    const session = await terminals.create({
      scope, title: 'Lazygit', cols: 120, rows: 40,
      start: { mode: 'command', command: `zsh -ic 'if [[ "$PWD" == "$HOME" ]]; then lgdf; else lazygit; fi'` },
    });
    return session.id;
  }
  return function open(threadId: string): Promise<string> {
    const existing = pending.get(threadId);
    if (existing) return existing;
    const operation = launch(threadId).finally(() => pending.delete(threadId));
    pending.set(threadId, operation);
    return operation;
  };
}
