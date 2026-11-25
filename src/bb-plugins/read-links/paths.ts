/** One entry per title BB renders for a row, in order; null where the title names no openable file. */
export type RowTargets = readonly (string | null)[];

type Intent =
  | { type: 'read'; path: string | null; name: string }
  | { type: 'list_files'; path: string | null }
  | { type: 'search'; path: string | null; query: string | null }
  | { type: 'unknown' };

export type TimelineRow = {
  id: string;
  kind: string;
  workKind?: string;
  path?: string | null;
  cwd?: string | null;
  approvalStatus?: string | null;
  activityIntents?: readonly Intent[];
  children?: readonly TimelineRow[] | null;
};

/** Where relative paths start: the command's working directory and the host user's home. */
export type Base = { cwd?: string | null; home: string | null };

export function resolvePath(path: string, { cwd, home }: Base): string | null {
  if (path.startsWith('/')) return path;
  if (path.startsWith('~/')) return home ? `${home.replace(/\/+$/, '')}/${path.slice(2)}` : null;
  if (path.startsWith('~') || !cwd?.startsWith('/')) return null;
  return `${cwd.replace(/\/+$/, '')}/${path.replace(/^(\.\/)+/, '')}`;
}

// Mirrors BB's getTimelineActivityIntentDetailDedupeKey.
function dedupeKey(intent: Intent): string | null {
  switch (intent.type) {
    case 'read': return `read:${intent.path ?? intent.name}`;
    case 'list_files': return `list:${intent.path ?? ''}`;
    case 'search': return `search:${intent.query ?? ''}|${intent.path ?? ''}`;
    case 'unknown': return null;
  }
}

// BB renders one compact title per non-unknown intent, skipping consecutive duplicates.
function commandTargets(row: TimelineRow, home: string | null): RowTargets {
  if (row.approvalStatus !== null) return [];
  const targets: (string | null)[] = [];
  let last: string | null = null;
  for (const intent of row.activityIntents ?? []) {
    if (intent.type === 'unknown') continue;
    const key = dedupeKey(intent);
    if (key !== null && key === last) continue;
    targets.push(intent.type === 'read' && intent.path ? resolvePath(intent.path, { cwd: row.cwd, home }) : null);
    last = key;
  }
  return targets;
}

export function collectTargets(rows: readonly TimelineRow[], home: string | null, into = new Map<string, RowTargets>()): Map<string, RowTargets> {
  for (const row of rows) {
    if (row.kind === 'work') {
      if ((row.workKind === 'file-read' || row.workKind === 'image-view') && row.path) into.set(row.id, [resolvePath(row.path, { cwd: row.cwd, home })]);
      else if (row.workKind === 'command') into.set(row.id, commandTargets(row, home));
    }
    if (row.children) collectTargets(row.children, home, into);
  }
  return into;
}
