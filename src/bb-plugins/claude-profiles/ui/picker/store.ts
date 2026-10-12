import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';

export type Focus = 'search' | 'account';
type Opened = { key: string; focus: Focus };

const listeners = new Set<() => void>();
let opened: Opened | null = null;
const notify = () => listeners.forEach(listener => listener());

export function open(composer: PluginComposerApi, options: { focus?: Focus } = {}) {
  opened = { key: composer.key, focus: options.focus ?? 'search' }; notify();
}
export function close() { opened = null; notify(); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function openedState() { return opened; }
