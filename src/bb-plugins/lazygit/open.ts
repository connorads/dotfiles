import type { BbPluginApi } from '@get-bb/plugin-sdk';

type Terminals = Pick<BbPluginApi['sdk']['terminals'], 'list' | 'create'>;

export function makeOpenLazygit(terminals: Terminals) {
  const pending = new Map<string, Promise<string>>();
  async function launch(threadId: string, cwd?: string) {
    const scope = { kind: 'thread', threadId } as const;
    const title = cwd === undefined ? 'Lazygit' : `Lazygit: ${cwd}`;
    const { sessions } = await terminals.list({ scope });
    const existing = sessions.find(s => s.title === title && (s.status === 'running' || s.status === 'starting'));
    if (existing) return existing.id;
    const session = await terminals.create({
      scope, title, cols: 120, rows: 40,
      start: cwd === undefined
        ? { mode: 'command', command: `zsh -ic 'if [[ "$PWD" == "$HOME" ]]; then lgdf; else lazygit; fi'` }
        : { mode: 'argv', argv: ['zsh', '-ic', 'cd -- "$1" && if [[ "$PWD" == "$HOME" ]]; then lgdf; else lazygit; fi', 'lazygit', cwd] },
    });
    return session.id;
  }
  return function open(threadId: string, cwd?: string): Promise<string> {
    const key = JSON.stringify([threadId, cwd]);
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = launch(threadId, cwd).finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  };
}
