import { useEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, useComposer } from '@get-bb/plugin-sdk/app';
import { Chip, ChipValue } from '@bb-plugins/chip';
import { draftChoice, message, resetDraft, resolve, statusNote, toggle, useExecutor } from './store.ts';

/** Native submits have no SDK data hook. Capture only this composer's form,
 * then submit through the SDK so dispatch receives the choice atomically. */
export function DraftConnection() {
  const composer = useComposer();
  const { view, draft, open, unsaved } = useExecutor();
  const marker = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);
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
  const resolved = resolve(view, draft);
  const signedOut = resolved.kind === 'connection' && resolved.status !== 'signed-in';
  const value = resolved.kind === 'connection' ? resolved.name : resolved.kind === 'off' ? 'Off' : 'None';
  const label = resolved.kind === 'off' ? 'Executor is off for this new thread'
    : `Executor: ${value}${resolved.kind === 'connection' && resolved.viaDefault ? ' (default)' : ''}${statusNote(resolved)}`;
  return <span ref={marker} className="ex-draft">
    <Chip data-executor-chip expanded={open?.threadId === null} tone={signedOut ? 'warn' : undefined} aria-label={label} title={`${label} (⌥E)`}
      onClick={event => toggle(null, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget)}
      icon={<Icon name="Plug02" />}>
      <ChipValue className={resolved.kind === 'off' ? 'ex-chip-off' : undefined}>{value}</ChipValue>
    </Chip>
    {(error ?? lost) && <span className="ex-draft-error" role="alert">{error ?? lost}</span>}
  </span>;
}
