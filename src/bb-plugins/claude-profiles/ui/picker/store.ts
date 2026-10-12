import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';

const listeners = new Set<() => void>();
let opened: string | null = null;
const notify = () => listeners.forEach(listener => listener());

export function open(composer: PluginComposerApi) { opened = composer.key; notify(); }
export function close() { opened = null; notify(); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function openedKey() { return opened; }
