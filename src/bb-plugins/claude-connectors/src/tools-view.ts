import type { ToolRow } from '../contracts.ts';

export type ToolFilter = 'all' | 'writes' | 'allowed';

export type ToolSummary = {
  total: number;
  allowed: number;
  writes: number;
  writesAllowed: number;
  custom: number;
};

/** True when a tool's access differs from its default (read-only allowed, writes off). */
export function isCustomOverride(tool: Pick<ToolRow, 'readOnly' | 'access'>): boolean {
  return tool.readOnly ? tool.access === 'off' : tool.access === 'allow';
}

/** Matches query against both tool name and description, then filters by access mode. */
export function filterTools(tools: readonly ToolRow[], query: string, mode: ToolFilter): ToolRow[] {
  const needle = query.trim().toLowerCase();
  return tools.filter(tool => {
    if (mode === 'writes' && tool.readOnly) return false;
    if (mode === 'allowed' && tool.access !== 'allow') return false;
    if (!needle) return true;
    return tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle);
  });
}

export function summarizeTools(tools: readonly ToolRow[]): ToolSummary {
  let allowed = 0;
  let writes = 0;
  let writesAllowed = 0;
  let custom = 0;
  for (const tool of tools) {
    if (tool.access === 'allow') allowed++;
    if (!tool.readOnly) {
      writes++;
      if (tool.access === 'allow') writesAllowed++;
    }
    if (isCustomOverride(tool)) custom++;
  }
  return { total: tools.length, allowed, writes, writesAllowed, custom };
}

type ConnectorStatus = { list: string[]; error: string | null } | 'loading' | undefined;

/**
 * Picks the most useful starting profile for Settings: global default, then an active project
 * default without an error, then the first non-errored profile, else the first profile.
 */
export function pickDefaultProfile(
  profiles: readonly string[],
  defaultChoice: string | undefined,
  projects: readonly { choice: string | null }[],
  connectors: ReadonlyMap<string, ConnectorStatus>,
): string {
  if (profiles.length === 0) return '';
  const hasError = (profile: string) => {
    const state = connectors.get(profile);
    return state !== undefined && state !== 'loading' && state.error !== null;
  };
  if (defaultChoice && profiles.includes(defaultChoice) && !hasError(defaultChoice)) return defaultChoice;
  for (const project of projects) {
    if (project.choice && profiles.includes(project.choice) && !hasError(project.choice)) return project.choice;
  }
  const healthy = profiles.find(profile => !hasError(profile));
  return healthy ?? profiles[0]!;
}
