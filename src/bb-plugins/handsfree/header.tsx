import { useSyncExternalStore } from 'react';

interface HeaderState { label: string; problem: boolean; expanded: boolean }

// One command controller owns status in each BB window, including split headers.
let state: HeaderState = { label: 'Voice', problem: false, expanded: false };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function publishVoiceHeader(next: HeaderState) {
  state = next;
  listeners.forEach(listener => listener());
}

export function VoiceHeader() {
  const current = useSyncExternalStore(subscribe, () => state);
  return <button type="button" className="handsfree-toggle" data-handsfree-header
    data-problem={current.problem} aria-label={`Voice monitor. ${current.label}`}
    aria-haspopup="dialog" aria-expanded={current.expanded} title={current.label}
    onClick={() => window.dispatchEvent(new Event('handsfree:open'))}>
    <span>{current.label}</span>
  </button>;
}
