import type { BbNavigate } from '@get-bb/plugin-sdk/app';
import type { RowTargets } from './paths';

/** A thread-surface navigator and an element inside that surface. */
export type Navigator = { anchor: Element; navigate: Pick<BbNavigate, 'experimental_openFilePreview'> };

const targets = new Map<string, RowTargets>();
const hosts = new Map<string, string>();
const wanted = new Set<string>();
const navigators = new Set<Navigator>();
const targetListeners = new Set<() => void>();
const wantedListeners = new Set<() => void>();

export const threadOf = (rowId: string) => rowId.slice(0, rowId.indexOf(':'));

export const getTargets = (rowId: string) => targets.get(rowId);
export const getHost = (threadId: string) => hosts.get(threadId);
export const setHost = (threadId: string, hostId: string) => { hosts.set(threadId, hostId); };

export function setTargets(found: ReadonlyMap<string, RowTargets>) {
  for (const [id, value] of found) { targets.set(id, value); wanted.delete(id); }
  if (found.size) for (const listener of targetListeners) listener();
}

/** Records rows the page shows but the store cannot map yet. Notifies only for new ids. */
export function want(ids: Iterable<string>) {
  let added = false;
  for (const id of ids) if (!targets.has(id) && !wanted.has(id)) { wanted.add(id); added = true; }
  if (added) for (const listener of wantedListeners) listener();
}

export const getWanted = (): ReadonlySet<string> => wanted;

export function onTargets(listener: () => void) { targetListeners.add(listener); return () => { targetListeners.delete(listener); }; }
export function onWanted(listener: () => void) { wantedListeners.add(listener); return () => { wantedListeners.delete(listener); }; }

export function addNavigator(navigator: Navigator) { navigators.add(navigator); return () => { navigators.delete(navigator); }; }

/** The navigator whose anchor shares the deepest ancestor with `element`, so a click opens the preview of its own split pane. */
export function nearestNavigator(element: Element): Navigator | null {
  const depth = new Map<Node, number>();
  let level = 0;
  for (let node: Node | null = element; node; node = node.parentNode) depth.set(node, level--);
  let best: Navigator | null = null;
  let bestDepth = -Infinity;
  for (const navigator of navigators) {
    if (!navigator.anchor.isConnected) continue;
    for (let node: Node | null = navigator.anchor; node; node = node.parentNode) {
      const shared = depth.get(node);
      if (shared === undefined) continue;
      if (shared > bestDepth) { best = navigator; bestDepth = shared; }
      break;
    }
  }
  return best;
}

export function resetStore() {
  targets.clear(); hosts.clear(); wanted.clear(); navigators.clear(); targetListeners.clear(); wantedListeners.clear();
}
