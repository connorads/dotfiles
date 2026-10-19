import { useEffect } from 'react';
import { useBbContext, useRealtimeConnectionState, useSdk } from '@get-bb/plugin-sdk/app';
import { getWanted, onWanted, setTimes, type MessageTime } from './store';

type Page = Awaited<ReturnType<ReturnType<typeof useSdk>['threads']['timeline']>>;
type Row = Page['rows'][number];

type OrderedTime = MessageTime & { sequence: number };

function collect(rows: readonly Row[], times: Map<string, OrderedTime>) {
  for (const row of rows) {
    if (row.kind === 'conversation') times.set(row.id, { id: row.id, timestamp: row.startedAt, role: row.role, sequence: row.sourceSeqStart });
    if (row.kind === 'turn' && row.children) collect(row.children, times);
  }
}

export function TimestampBridge() {
  const { threadId } = useBbContext();
  const sdk = useSdk();
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    setTimes([]);
    if (!threadId) return;
    const activeThreadId = threadId;
    const controller = new AbortController();
    const times = new Map<string, OrderedTime>();
    // BB row IDs include the thread ID. Ignore embedded chats for other threads.
    const missing = () => [...getWanted()].some(id => id.startsWith(`${activeThreadId}:`) && (!times.has(id) || times.get(id)?.previousTimestamp === undefined));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    let dirty = false;
    async function load() {
      timer = undefined;
      if (loading) { dirty = true; return; }
      loading = true;
      try {
        let cursor: Page['timelinePage']['olderCursor'] = null;
        do {
          const page = await sdk.threads.timeline({
            threadId: activeThreadId, signal: controller.signal,
            deferContent: 'true', includeNestedRows: 'true', segmentLimit: '5',
            ...(cursor ? { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) } : {}),
          });
          if (controller.signal.aborted) return;
          collect(page.rows, times);
          cursor = page.timelinePage.olderCursor;
          const ordered = [...times.values()].sort((a, b) => a.sequence - b.sequence);
          for (let index = 0; index < ordered.length; index++) {
            // Only a complete history boundary establishes the first message.
            ordered[index].previousTimestamp = index > 0 ? ordered[index - 1].timestamp : cursor ? undefined : null;
          }
          setTimes(ordered);
        } while (cursor && missing());
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[chat-timestamps] Could not read message times', error);
      } finally {
        loading = false;
        if (dirty && !controller.signal.aborted) { dirty = false; schedule(); }
      }
    }
    // Bound refresh frequency during streaming; do not postpone forever on frequent updates.
    function schedule() {
      if (timer === undefined) timer = setTimeout(() => { void load(); }, 750);
    }
    const stopRows = onWanted(() => {
      if (missing()) schedule();
    });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
      stopRows();
      setTimes([]);
    };
  }, [sdk, threadId, connection]);
  return null;
}
