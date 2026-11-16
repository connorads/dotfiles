/** A profile name, or "off". Absent means "inherit". */
export type Choice = string;
export const OFF = 'off';

/**
 * `readOnly` refuses every tool that may write, whatever the profile allows.
 * `only` names the connectors in reach; null means every connector of the profile.
 */
export type Resolved = { profile: string | null; source: 'thread' | 'owner' | 'project' | 'default'; readOnly: boolean; only: string[] | null };
/** What a thread's owner passes on. `share` false passes nothing. */
export type Owner = { resolved: Resolved; share: boolean };

/**
 * The chat's own pick, then its owner's access, then its project's default, then the global default.
 * A thread with an owner gets what the owner resolves to, read-only, so access only narrows on the way down.
 * `only` is the thread's own connector list; an owned thread takes its owner's.
 */
export function resolveChoice(thread: Choice | undefined, project: Choice | undefined, fallback: Choice | undefined,
  { only = null, owner }: { only?: string[] | null; owner?: Owner } = {}): Resolved {
  const pick = (value: Choice | undefined) => (value === OFF ? null : value ?? null);
  if (thread !== undefined) return { profile: pick(thread), source: 'thread', readOnly: false, only };
  if (owner) return { profile: owner.share ? owner.resolved.profile : null, source: 'owner', readOnly: true, only: owner.resolved.only };
  if (project !== undefined) return { profile: pick(project), source: 'project', readOnly: false, only };
  return { profile: pick(fallback || undefined), source: 'default', readOnly: false, only };
}

export function inScope(only: string[] | null, connector: string): boolean {
  return only === null || only.some(name => name.toLowerCase() === connector.toLowerCase());
}

/** The thread that started this one: its parent, else the origin of its BB workflow run. Workflow workers have no parent. */
export function ownerOf(thread: { parentThreadId: string | null; originPluginId: string | null; lifecycleOwnerThreadId: string | null }): string | null {
  if (thread.parentThreadId) return thread.parentThreadId;
  return thread.originPluginId === 'workflows' ? thread.lifecycleOwnerThreadId : null;
}

export function isProfileName(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value) && value !== OFF && !value.startsWith('.');
}
