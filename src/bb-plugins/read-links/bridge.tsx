import { useEffect } from 'react';
import { useRpc, useSdk } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts';
import { loadTargets, type FetchPage } from './loader';
import { getHost, getTargets, getWanted, onWanted, setHost, setTargets, threadOf } from './store';

const DEBOUNCE_MS = 250;

/** Loads read targets for whichever threads' rows the content script reports. */
export function TargetBridge() {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    const controller = new AbortController();
    const loading = new Set<string>();
    const dirty = new Set<string>();
    const homes = new Map<string, Promise<string | null>>();
    // A missing home only stops `~` paths from linking.
    const homeOf = (hostId: string) => {
      let home = homes.get(hostId);
      if (!home) {
        home = rpc.call('homeDir', { hostId }).catch(error => { console.warn('[read-links] Could not read host home', error); return null; });
        homes.set(hostId, home);
      }
      return home;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load(threadId: string) {
      if (loading.has(threadId)) { dirty.add(threadId); return; }
      loading.add(threadId);
      const { signal } = controller;
      try {
        if (!getHost(threadId)) {
          const { environmentId } = await sdk.threads.get({ threadId, signal });
          // Without an environment there is no host to open files on.
          if (!environmentId) return;
          const environment = await sdk.environments.get({ environmentId, signal });
          setHost(threadId, environment.hostId);
        }
        const hostId = getHost(threadId);
        if (!hostId) return;
        const home = await homeOf(hostId);
        const wanted = new Set([...getWanted()].filter(id => threadOf(id) === threadId));
        const fetchPage: FetchPage = async (cursor, pageSignal) => {
          const page = await sdk.threads.timeline({
            threadId, signal: pageSignal, deferContent: 'true', includeNestedRows: 'true', segmentLimit: '20',
            ...(cursor ? { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) } : {}),
          });
          return { rows: page.rows, olderCursor: page.timelinePage.olderCursor };
        };
        setTargets(await loadTargets(fetchPage, wanted, home, signal));
      } catch (error) {
        if (!signal.aborted) console.warn('[read-links] Could not load read rows', threadId, error);
      } finally {
        loading.delete(threadId);
        if (dirty.delete(threadId) && !signal.aborted) void load(threadId);
      }
    }

    function flush() {
      timer = undefined;
      const threads = new Set([...getWanted()].filter(id => !getTargets(id)).map(threadOf));
      for (const threadId of threads) void load(threadId);
    }
    const stop = onWanted(() => { if (timer === undefined) timer = setTimeout(flush, DEBOUNCE_MS); });
    flush();
    return () => { controller.abort(); clearTimeout(timer); stop(); };
  }, [sdk, rpc]);
  return null;
}
