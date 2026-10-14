import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type { ComposerSelection, PluginComposerScope } from '@get-bb/plugin-sdk/app';

type Terminals = Pick<BbPluginApi['sdk']['terminals'], 'list' | 'create'>;
type Projects = Pick<BbPluginApi['sdk']['projects'], 'get'>;
type Session = Awaited<ReturnType<Terminals['create']>>;

/** A thread's checkout, or what the New thread composer would run in: a reused environment or the project's default checkout. */
export type LazygitTarget =
  | { kind: 'thread'; threadId: string }
  | { kind: 'environment'; environmentId: string }
  | { kind: 'project'; projectId: string };

/** Where a composer's lazygit runs, or null for a queued message or a New thread with no project picked. */
export function composerTarget(scope: PluginComposerScope, selection: ComposerSelection | null): LazygitTarget | null {
  if (scope.kind === 'thread') return { kind: 'thread', threadId: scope.threadId };
  if (scope.kind !== 'new-thread' || scope.projectId === null) return null;
  const environment = selection?.environment;
  if (environment?.type === 'reuse') return { kind: 'environment', environmentId: environment.environmentId };
  return { kind: 'project', projectId: scope.projectId };
}

export function makeOpenLazygit(terminals: Terminals, projects: Projects) {
  const pending = new Map<string, Promise<string>>();
  /**
   * The New thread screen's terminal panel accepts only terminals in its own
   * scope: the reused environment, else host terminals with no thread or
   * environment started in the project's checkout. Match that scope.
   */
  async function scopeFor(target: LazygitTarget) {
    if (target.kind === 'thread') return { scope: target, owns: () => true };
    if (target.kind === 'environment') return { scope: target, owns: (s: Session) => s.threadId === null };
    const { sources } = await projects.get({ projectId: target.projectId });
    const source = sources.find(s => s.isDefault) ?? sources[0];
    if (!source) throw new Error('This project has no local checkout for lazygit.');
    const scope = { kind: 'host_path', hostId: source.hostId, cwd: source.path } as const;
    const owns = (s: Session) => s.threadId === null && s.environmentId === null && s.initialCwd === source.path;
    return { scope, owns };
  }
  async function launch(target: LazygitTarget) {
    const { scope, owns } = await scopeFor(target);
    const { sessions } = await terminals.list({ scope });
    const existing = sessions.find(s => owns(s) && s.title === 'Lazygit' && (s.status === 'running' || s.status === 'starting'));
    if (existing) return existing.id;
    const session = await terminals.create({
      scope, title: 'Lazygit', cols: 120, rows: 40,
      start: { mode: 'command', command: `zsh -ic 'if [[ "$PWD" == "$HOME" ]]; then lgdf; else lazygit; fi'` },
    });
    return session.id;
  }
  return function open(target: LazygitTarget): Promise<string> {
    const key = target.kind === 'thread' ? `thread:${target.threadId}`
      : target.kind === 'environment' ? `environment:${target.environmentId}` : `project:${target.projectId}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = launch(target).finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  };
}
