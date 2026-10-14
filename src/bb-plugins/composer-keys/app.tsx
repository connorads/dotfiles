import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, useBbContext, useSdk } from '@get-bb/plugin-sdk/app';
import { editedInput, promptsFromEvents, type Prompt } from './rewind.ts';
import './app.css';

// BB hardcodes these key handlers, so the plugin re-dispatches the keys BB already understands.
// The question box placeholder is the only stable marker BB renders on it.
const QUESTION_PLACEHOLDER = 'Type your own answer…';

const isComposer = (el: HTMLElement) => el.closest('[data-promptbox] [contenteditable="true"]') !== null;
const isQuestion = (el: HTMLElement) => el instanceof HTMLTextAreaElement && el.placeholder === QUESTION_PLACEHOLDER;

function redispatch(target: HTMLElement, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...init }));
}

function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (event.altKey && isComposer(target)) {
    event.preventDefault(); event.stopImmediatePropagation();
    redispatch(target, { shiftKey: true });
  } else if (isQuestion(target)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.altKey) document.execCommand('insertText', false, '\n');
    else redispatch(target, { metaKey: true });
  }
}

const DOUBLE_ESCAPE_MS = 500;
let armedAt: number | null = null;
const REWIND_EVENT = 'composer-keys:rewind';

// BB's composer answers an unclaimed Escape by blurring itself. Other Escape uses
// (mention menu, voice input) keep focus, so a blur marks the Escape as ours.
// Running: stop the run. Idle and empty: a second Escape, which lands on <body>, opens the rewind picker.
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (armedAt !== null && target === document.body && event.timeStamp - armedAt <= DOUBLE_ESCAPE_MS) {
    armedAt = null;
    window.dispatchEvent(new Event(REWIND_EVENT));
    return;
  }
  armedAt = null;
  if (!isComposer(target) || document.activeElement === target) return;
  const stop = target.closest('[data-promptbox]')?.querySelector<HTMLButtonElement>('button[aria-label="Stop run"]');
  if (stop) {
    stop.click();
    target.focus();
  } else if (target.textContent?.trim() === '') {
    armedAt = event.timeStamp;
  }
}

const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? '(no text)';

// BB serves at most 100 events per request.
const EVENT_PAGE = 100;

async function loadPrompts(sdk: ReturnType<typeof useSdk>, threadId: string) {
  const rows: Parameters<typeof promptsFromEvents>[0][number][] = [];
  for (let afterSeq: string | undefined; ;) {
    const page = await sdk.threads.events.list({
      threadId, types: ['client/turn/requested'], order: 'asc', limit: String(EVENT_PAGE), ...afterSeq ? { afterSeq } : {},
    });
    rows.push(...page);
    if (page.length < EVENT_PAGE) return promptsFromEvents(rows);
    afterSeq = String(page[page.length - 1]!.seq);
  }
}

type View = { kind: 'closed' } | { kind: 'list' } | { kind: 'edit'; draft: string };

// Lists the thread's user prompts. Enter edits one and rewinds the thread from it;
// f forks a new thread from just before it.
function RewindPicker() {
  const { threadId } = useBbContext();
  const sdk = useSdk();
  const [view, setView] = useState<View>({ kind: 'closed' });
  // null while a load is in flight.
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const load = useRef(0);
  const prompt = prompts?.[index];
  const count = prompts?.length ?? 0;

  useEffect(() => {
    const open = () => {
      if (!threadId) return;
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Only the latest open's load lands, so the list never holds another load's prompts.
      const token = ++load.current;
      setError(null);
      setPrompts(null);
      setView({ kind: 'list' });
      loadPrompts(sdk, threadId)
        .then(found => { if (token === load.current) { setPrompts(found); setIndex(found.length - 1); } })
        .catch((cause: unknown) => { if (token === load.current) setError(String(cause)); });
    };
    window.addEventListener(REWIND_EVENT, open);
    return () => window.removeEventListener(REWIND_EVENT, open);
  }, [sdk, threadId]);

  const close = useCallback(() => { setView({ kind: 'closed' }); setBusy(false); }, []);

  useEffect(() => {
    if (view.kind === 'closed') { origin.current?.focus(); origin.current = null; }
    else if (view.kind === 'list') list.current?.focus();
  }, [view.kind]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }, [close]);

  const rewind = useCallback((draft: string) => {
    if (!threadId || !prompt || draft.trim() === '') return;
    void run(() => sdk.threads.editMessage({
      threadId, operationId: crypto.randomUUID(), expectedRequestSequence: prompt.seq,
      input: editedInput(prompt, draft) as never,
    }));
  }, [prompt, run, sdk, threadId]);

  const fork = useCallback(() => {
    if (!threadId || !prompt) return;
    void run(async () => {
      const forked = await sdk.threads.fork({ sourceThreadId: threadId, sourceSeqEnd: prompt.seq });
      await sdk.threads.open({ threadId: forked.id, file: null });
    });
  }, [prompt, run, sdk, threadId]);

  useEffect(() => {
    if (view.kind !== 'list') return;
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const move = event.key === 'ArrowUp' || event.key === 'k' ? -1 : event.key === 'ArrowDown' || event.key === 'j' ? 1
        : event.key === 'Home' ? -count : event.key === 'End' ? count : 0;
      if (move === 0 && !['Enter', 'Escape', 'f'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (busy) return;
      if (move !== 0) setIndex(i => Math.min(Math.max(i + move, 0), count - 1));
      else if (event.key === 'Escape') close();
      else if (event.key === 'Enter' && prompt) setView({ kind: 'edit', draft: prompt.text });
      else if (event.key === 'f') fork();
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [busy, close, count, fork, prompt, view.kind]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index, view.kind]);

  if (view.kind === 'closed') return null;
  return <div className="ck-backdrop" onMouseDown={close}>
    <div className="ck-picker" role="dialog" aria-label="Rewind" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
      <header>Rewind{prompt && view.kind === 'edit' ? ` from message ${index + 1}` : ''}</header>
      {view.kind === 'list'
        ? <ol ref={list} role="listbox" aria-label="Your messages" tabIndex={-1} onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) || busy) return;
          if (event.key === 'q' || event.key === 'Q') { event.preventDefault(); event.stopPropagation(); close(); }
        }}>
          {prompts?.map((p, i) => <li key={p.seq} role="option" aria-selected={i === index}
            onMouseEnter={() => setIndex(i)} onClick={() => setView({ kind: 'edit', draft: p.text })}>
            <span className="ck-num">{i + 1}</span><span className="ck-text">{firstLine(p.text)}</span>
          </li>)}
          {!error && (prompts === null ? <li className="ck-empty">Loading…</li>
            : count === 0 && <li className="ck-empty">No messages to rewind yet.</li>)}
        </ol>
        : <textarea autoFocus value={view.draft} disabled={busy} aria-label="Edited message"
          onChange={e => setView({ kind: 'edit', draft: e.target.value })}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') { e.preventDefault(); setView({ kind: 'list' }); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); rewind(view.draft); }
            else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); document.execCommand('insertText', false, '\n'); }
          }} />}
      {error && <p className="ck-error" role="alert">{error}</p>}
      <footer>{view.kind === 'list'
        ? '↑↓/jk move · Home/End ends · Enter edit and rewind · f fork from here · Q/Esc close'
        : busy ? 'Rewinding…' : 'Enter rewind · Alt/Shift+Enter newline · Esc back'}</footer>
    </div>
  </div>;
}

function ComposerKeys() {
  useEffect(() => {
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return <RewindPicker />;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'composer-keys', component: ComposerKeys });
});
