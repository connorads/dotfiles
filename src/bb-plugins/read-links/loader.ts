import { collectTargets, type RowTargets, type TimelineRow } from './paths';

export type Cursor = { anchorId: string; anchorSeq: number };
export type TimelinePage = { rows: readonly TimelineRow[]; olderCursor: Cursor | null };
export type FetchPage = (cursor: Cursor | null, signal: AbortSignal) => Promise<TimelinePage>;

const MAX_PAGES = 100;

/** Reads the newest pages first and stops once every wanted row is mapped or history ends. */
export async function loadTargets(fetchPage: FetchPage, wanted: ReadonlySet<string>, home: string | null, signal: AbortSignal): Promise<Map<string, RowTargets>> {
  const found = new Map<string, RowTargets>();
  let cursor: Cursor | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(cursor, signal);
    signal.throwIfAborted();
    collectTargets(result.rows, home, found);
    cursor = result.olderCursor;
    if (!cursor || [...wanted].every(id => found.has(id))) break;
  }
  return found;
}
