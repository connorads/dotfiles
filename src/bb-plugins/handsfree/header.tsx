import { useSyncExternalStore } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import { Chip, ChipValue } from '@bb-plugins/chip';

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

/** Idle shows only the mic; activity and results show their text beside it. */
export function VoiceHeader() {
  const current = useSyncExternalStore(subscribe, () => state);
  const text = current.label.replace(/^Voice( · )?/, '');
  return <Chip className="handsfree-toggle" data-handsfree-header tone={current.problem ? 'danger' : undefined}
    aria-label={`Voice monitor. ${current.label}`} expanded={current.expanded} title={current.label}
    onClick={() => window.dispatchEvent(new Event('handsfree:open'))} icon={<Icon name="Mic" />}>
    {text && <ChipValue>{text}</ChipValue>}
  </Chip>;
}
