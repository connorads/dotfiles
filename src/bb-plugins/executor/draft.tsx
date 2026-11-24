import { useEffect, useRef, useState } from 'react';
import { useComposer } from '@get-bb/plugin-sdk/app';
import { Chip, ChipDot, ChipValue, type ChipTone, type DotTone } from '@bb-plugins/chip';
import { ExecutorMark } from './mark.tsx';
import { draftChoice, healthKind, message, resetDraft, resolve, setDraftProject, sourceTag, statusNote, toggle, useExecutor } from './store.ts';

/** Native submits have no SDK data hook. Capture only this composer's form,
 * then submit through the SDK so dispatch receives the choice atomically. */
export function DraftConnection() {
  const composer = useComposer();
  const projectId = composer.selection?.projectId ?? null;
  const { view, draft, open, unsaved } = useExecutor();
  const marker = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraftProject(projectId);
    return () => setDraftProject(null);
  }, [projectId]);
  useEffect(() => {
    const form = marker.current?.closest('form[data-promptbox]');
    if (!(form instanceof HTMLFormElement)) return;
    let submitting = false;
    const submit = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (submitting) return;
      submitting = true;
      setError(null);
      void composer.submit({ experimental_data: { executorChoice: draftChoice() } })
        .catch(cause => setError(message(cause)))
        .finally(() => { submitting = false; });
    };
    // The editor sends Enter directly instead of requesting a form submit.
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof HTMLElement) || !form.contains(event.target) || !event.target.closest('[contenteditable="true"]')) return;
      if (document.querySelector('[role="listbox"], [data-tippy-root]')) return;
      submit(event);
    };
    form.addEventListener('submit', submit, true);
    window.addEventListener('keydown', keydown, true);
    const unsubscribe = composer.onSubmitted(resetDraft);
    return () => {
      form.removeEventListener('submit', submit, true);
      window.removeEventListener('keydown', keydown, true);
      unsubscribe(); resetDraft();
    };
  }, [composer]);
  // An add that failed after the draft's popover closed; the popover says it itself while open.
  const lost = unsaved?.threadId === null && open?.threadId !== null ? unsaved.message : null;
  const resolved = resolve(view, draft, { projectId });
  const connError = resolved.kind === 'connection' ? view?.errors[resolved.id] : undefined;
  const kind = resolved.kind === 'connection' ? healthKind(resolved.connection, connError) : null;
  const tag = sourceTag(resolved.source);
  let chipTone: ChipTone | undefined;
  let dotTone: DotTone | null = null;
  if (kind === 'reauth' || kind === 'unreachable' || kind === 'error') {
    chipTone = 'danger';
    dotTone = 'danger';
  } else if (kind === 'degraded' || kind === 'signed-out' || kind === 'signing-in') {
    chipTone = 'warn';
    dotTone = 'warn';
  } else if (kind === 'ok') {
    dotTone = 'ok';
  }
  const label = resolved.kind === 'off'
    ? `Executor is off for this new thread${tag ? ` (${tag})` : ''}`
    : resolved.kind === 'connection'
      ? `Executor: ${resolved.name}${tag ? ` (${tag})` : ''}${statusNote(resolved, connError)}`
      : 'No Executor connection';
  return <span ref={marker} className="ex-draft">
    <Chip data-executor-chip expanded={open?.threadId === null} tone={chipTone} aria-label={label} title={`${label} (⌥E)`}
      onClick={event => toggle(null, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget, projectId)}
      icon={<ExecutorMark />}>
      {resolved.kind === 'off' && <span className="ex-chip-off">
        Off{tag && <span className="ex-chip-source"> · {tag}</span>}
      </span>}
      {resolved.kind === 'connection' && <ChipValue>
        {resolved.name}{tag && <span className="ex-chip-source"> · {tag}</span>}
      </ChipValue>}
      {dotTone && <ChipDot tone={dotTone} />}
    </Chip>
    {(error ?? lost) && <span className="ex-draft-error" role="alert">{error ?? lost}</span>}
  </span>;
}
