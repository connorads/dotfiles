import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';

export type Focus = 'search' | 'account';
type Opened = { key: string; focus: Focus };

const listeners = new Set<() => void>();
let opened: Opened | null = null;
const notify = () => listeners.forEach(listener => listener());

export function open(composer: PluginComposerApi, options: { focus?: Focus } = {}) {
  // Queued-message editors cannot change a thread's model or account.
  if (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread') return;
  opened = { key: composer.key, focus: options.focus ?? 'search' }; notify();
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
