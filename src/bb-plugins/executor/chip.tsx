import { useEffect } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import { Chip, ChipDot, ChipValue } from '@bb-plugins/chip';
import { loadChoice, resolve, statusNote, toggle, useExecutor } from './store.ts';

/** Hidden until a connection exists: ⌥E still opens the pop-up, which says how to add one. */
export function ExecutorChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { view, choices, open, unsaved } = useExecutor();
  useEffect(() => { void loadChoice(threadId); }, [threadId]);
  if (!view || view.connections.length === 0) return null;
  const resolved = resolve(view, choices.get(threadId));
  const value = resolved.kind === 'connection' ? resolved.name : 'None';
  const signedOut = resolved.kind === 'connection' && resolved.status !== 'signed-in';
  // A pick or add that failed after its popover closed: the chip names the saved connection, so say why.
  const failed = unsaved?.threadId === threadId ? unsaved.message : null;
  const label = (resolved.kind === 'connection'
    ? `Executor: ${resolved.name}${resolved.viaDefault ? ' (default)' : ''}${statusNote(resolved)}`
    : resolved.kind === 'off' ? 'Executor is off for this thread' : 'No Executor connection') + (failed ? `. ${failed}` : '');
  // A failed pick tints only the border and dot: danger tone would also redden the name of the connection that is fine.
  return <Chip data-executor-chip expanded={open?.threadId === threadId} tone={failed || signedOut ? 'warn' : undefined}
    aria-label={label} title={`${label} (⌥E)`}
    onClick={event => toggle(threadId, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget)}
    icon={<Icon name="Plug02" />}>
    {/* Off stays visible in a narrow header, where every ChipValue hides: an icon alone would look like a live connection. */}
    {resolved.kind === 'off' ? <span className="ex-chip-off">Off</span> : !isCompactViewport && <ChipValue>{value}</ChipValue>}
    {failed ? <ChipDot tone="danger" /> : signedOut && <ChipDot tone="warn" />}
  </Chip>;
}
