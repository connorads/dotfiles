import { useSyncExternalStore } from 'react';
import { definePluginApp, experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import { Chip } from '@bb-plugins/chip';
import { ShortcutPopover } from './popover.tsx';
import './app.css';

interface Open { focus: HTMLElement | null; instant: boolean }
let opened: Open | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function close() { opened = null; listeners.forEach(listener => listener()); }
function toggle(instant: boolean) {
  if (opened) { close(); return; }
  opened = { focus: document.activeElement instanceof HTMLElement ? document.activeElement : null, instant };
  listeners.forEach(listener => listener());
}
function Overlay() {
  const open = useSyncExternalStore(subscribe, () => opened);
  return open ? <ShortcutPopover returnFocus={open.focus} instant={open.instant} onClose={close} /> : null;
}
function ShortcutChip() {
  const open = useSyncExternalStore(subscribe, () => opened !== null);
  return <Chip icon={<Icon name="Keyboard" />} expanded={open} aria-label="Shortcut guide" title="Shortcut guide (⌥/)"
    onClick={event => toggle(event.detail === 0)} />;
}
export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'guide', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'guide', title: 'Shortcut guide', component: ShortcutChip });
  app.commands.register({ id: 'toggle', title: 'Show shortcut guide', defaultShortcut: { key: '/', alt: true }, run: () => toggle(true) });
});
