/** A profile name, or "off". Absent means "inherit". */
export type Choice = string;
export const OFF = 'off';

export type Resolved = { profile: string | null; source: 'thread' | 'project' | 'default' };

/** The chat's own pick, then its project's default, then the global default. */
export function resolveChoice(thread: Choice | undefined, project: Choice | undefined, fallback: Choice | undefined): Resolved {
  const pick = (value: Choice | undefined) => (value === OFF ? null : value ?? null);
  if (thread !== undefined) return { profile: pick(thread), source: 'thread' };
  if (project !== undefined) return { profile: pick(project), source: 'project' };
  return { profile: pick(fallback || undefined), source: 'default' };
}

export function isProfileName(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value) && value !== OFF && !value.startsWith('.');
}
