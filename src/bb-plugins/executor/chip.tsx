import { useEffect } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import { Chip, ChipDot, ChipValue } from '@bb-plugins/chip';
import { loadChoice, resolve, toggle, useExecutor } from './store.ts';

/** Hidden until a connection exists: ⌥E still opens the pop-up, which says how to add one. */
export function ExecutorChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { view, choices, open } = useExecutor();
  useEffect(() => { void loadChoice(threadId); }, [threadId]);
  if (!view || view.connections.length === 0) return null;
  const resolved = resolve(view, choices.get(threadId));
  const value = resolved.kind === 'connection' ? resolved.name : resolved.kind === 'off' ? 'Off' : 'None';
  const signedOut = resolved.kind === 'connection' && !resolved.signedIn;
  const label = resolved.kind === 'connection'
    ? `Executor: ${resolved.name}${resolved.viaDefault ? ' (default)' : ''}${signedOut ? ', signed out' : ''}`
    : resolved.kind === 'off' ? 'Executor is off for this thread' : 'No Executor connection';
  return <Chip data-executor-chip expanded={open?.threadId === threadId} tone={signedOut ? 'warn' : undefined}
    aria-label={label} title={`${label} (⌥E)`}
    onClick={event => toggle(threadId, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget)}
    icon={<Icon name="Plug02" />}>
    {!isCompactViewport && <ChipValue className={resolved.kind === 'off' ? 'ex-chip-off' : undefined}>{value}</ChipValue>}
    {signedOut && <ChipDot tone="warn" />}
  </Chip>;
}
