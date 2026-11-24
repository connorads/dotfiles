import { useEffect, useRef } from 'react';
import { Chip, ChipDot, ChipValue, type ChipTone, type DotTone } from '@bb-plugins/chip';
import type { ThreadHeaderChipProps } from '@bb-plugins/chip/header';
import { ExecutorMark } from './mark.tsx';
import { checkOne, healthKind, loadChoice, loadOwner, rememberThreadProject, resolve, sourceTag, statusNote, toggle, useExecutor } from './store.ts';

export function ExecutorChip({ threadId, projectId, isCompactViewport }: ThreadHeaderChipProps) {
  const { view, choices, owners, open, unsaved } = useExecutor();
  const loaded = view !== null;
  useEffect(() => {
    rememberThreadProject(threadId, projectId);
    if (loaded) {
      void loadChoice(threadId);
      void loadOwner(threadId, projectId);
    }
  }, [threadId, projectId, loaded]);

  const choice = choices.get(threadId);
  const owner = owners.get(threadId) ?? null;
  const resolved = resolve(choice ? view : null, choice, { projectId, owner });
  // Lazily verify the thread's active connection once if its health has never been probed yet.
  const probedId = useRef<string | null>(null);
  const activeId = resolved.kind === 'connection' ? resolved.id : null;
  const activeStatus = resolved.kind === 'connection' ? resolved.status : null;
  const activeHealth = resolved.kind === 'connection' ? (resolved.connection.health?.state ?? 'unknown') : null;
  useEffect(() => {
    if (!activeId || activeStatus !== 'signed-in' || activeHealth !== 'unknown') return;
    if (probedId.current === activeId) return;
    probedId.current = activeId;
    void checkOne(activeId, false);
  }, [activeId, activeStatus, activeHealth]);

  if (!view) return null;

  const connError = resolved.kind === 'connection' ? view.errors[resolved.id] : undefined;
  const kind = resolved.kind === 'connection' ? healthKind(resolved.connection, connError) : null;
  const tag = sourceTag(resolved.source);
  // A pick or add that failed after its popover closed: the chip names the saved connection, so say why.
  const failed = unsaved?.threadId === threadId ? unsaved.message : null;
  const label = (resolved.kind === 'connection'
    ? `Executor: ${resolved.name}${tag ? ` (${tag})` : ''}${statusNote(resolved, connError)}`
    : resolved.kind === 'off'
      ? `Executor is off for this thread${tag ? ` (${tag})` : ''}`
      : 'No Executor connection') + (failed ? `. ${failed}` : '');

  // A failed pick tints the border warn (so the saved connection name stays legible) and puts a danger dot beside it.
  // A rejected sign-in or unreachable server uses danger tone so it's impossible to miss.
  let chipTone: ChipTone | undefined;
  let dotTone: DotTone | null = null;
  if (failed) {
    chipTone = 'warn';
    dotTone = 'danger';
  } else if (kind === 'reauth' || kind === 'unreachable' || kind === 'error') {
    chipTone = 'danger';
    dotTone = 'danger';
  } else if (kind === 'degraded' || kind === 'signed-out' || kind === 'signing-in') {
    chipTone = 'warn';
    dotTone = 'warn';
  } else if (kind === 'ok') {
    dotTone = 'ok';
  }

  return <Chip data-executor-chip expanded={open?.threadId === threadId} tone={chipTone}
    aria-label={label} title={`${label} (⌥E)`}
    onClick={event => toggle(threadId, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget, projectId)}
    icon={<ExecutorMark />}>
    {/* Off stays visible in a narrow header, where every ChipValue hides: an icon alone would look like a live connection. */}
    {resolved.kind === 'off' && <span className="ex-chip-off">
      Off{!isCompactViewport && tag && <span className="ex-chip-source"> · {tag}</span>}
    </span>}
    {resolved.kind === 'connection' && !isCompactViewport && <ChipValue>
      {resolved.name}{tag && <span className="ex-chip-source"> · {tag}</span>}
    </ChipValue>}
    {dotTone && <ChipDot tone={dotTone} />}
  </Chip>;
}
