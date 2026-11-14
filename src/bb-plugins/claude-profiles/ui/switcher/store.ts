import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';

export type Anchor = { top: number; bottom: number; left: number };
type Opened = { key: string; anchor: Anchor | null };

const listeners = new Set<() => void>();
let opened: Opened | null = null;
const notify = () => listeners.forEach(listener => listener());

// Each composer's chip registers itself so a shortcut can open the switcher beside it.
const anchors = new Map<string, HTMLElement>();
export function registerAnchor(key: string, element: HTMLElement | null) {
  if (element) anchors.set(key, element); else anchors.delete(key);
}
const rect = (element: HTMLElement | undefined): Anchor | null => {
  if (!element?.isConnected) return null;
  const { top, bottom, left } = element.getBoundingClientRect();
  return { top, bottom, left };
};

export function open(composer: PluginComposerApi) {
  // Queued-message editors cannot change a thread's model or account.
  if (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread') return;
  opened = { key: composer.key, anchor: rect(anchors.get(composer.key)) }; notify();
}
export function close() { opened = null; notify(); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function openedState() { return opened; }

const selectionListeners = new Set<(key: string) => void>();
export function selectionChanged(key: string) { selectionListeners.forEach(listener => listener(key)); }
export function subscribeSelection(listener: (key: string) => void) {
  selectionListeners.add(listener);
  return () => { selectionListeners.delete(listener); };
}
