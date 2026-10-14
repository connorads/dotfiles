import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { definePluginApp, experimental_copyToClipboard, experimental_Icon as Icon, useComposer, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { pillParts } from './src/mention.ts';
import { chosenRefs, cursorRow, initialState, onKey, setQuery, type Action } from './src/picker.ts';
import { filterRows, groupRefs, type Row } from './src/rows.ts';

const POPUP_ID = 'skl';

type Catalogue = { hostId: string; canInstall: boolean; rows: Row[] };
type Notice = { tone: 'info' | 'error'; text: string };

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function SklPopup() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = composer.scope.kind === 'new-thread' ? null : composer.scope.threadId;
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [state, setState] = useState(initialState);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<readonly string[] | null>(null);
  const [preview, setPreview] = useState<{ ref: string; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    rpc.call('catalogue', { threadId })
      .then(next => { if (live) setCatalogue(next); })
      .catch(cause => { if (live) setNotice({ tone: 'error', text: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId]);

  const all = catalogue?.rows ?? [];
  const visible = useMemo(() => filterRows(all, state.query), [all, state.query]);
  const current = cursorRow(state, visible);

  useEffect(() => {
    if (!state.preview || !current || !catalogue || preview?.ref === current.ref) return;
    let live = true;
    const ref = current.ref;
    const timer = setTimeout(() => {
      rpc.call('preview', { hostId: catalogue.hostId, ref })
        .then(({ text }) => { if (live) setPreview({ ref, text }); })
        .catch(cause => { if (live) setPreview({ ref, text: message(cause) }); });
    }, 80);
    return () => { live = false; clearTimeout(timer); };
  }, [rpc, catalogue, current, state.preview, preview?.ref]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [state.cursor, visible]);

  const install = async (refs: readonly string[]) => {
    if (!threadId) return;
    setConfirming(null);
    setBusy(true);
    setNotice({ tone: 'info', text: `Installing ${refs.join(', ')}…` });
    try {
      const result = await rpc.call('install', { threadId, refs: [...refs] });
      setNotice({ tone: result.ok ? 'info' : 'error', text: result.output });
      if (result.ok) setState(previous => ({ ...previous, marked: [] }));
    } catch (cause) {
      setNotice({ tone: 'error', text: message(cause) });
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: Action, refs: readonly string[]) => {
    if (!catalogue || busy) return;
    if (action === 'load') {
      composer.insert(pillParts(catalogue.hostId, refs));
      composer.experimental_closePopup();
      return;
    }
    if (action === 'copy') {
      setBusy(true);
      try {
        const { text } = await rpc.call('pointers', { hostId: catalogue.hostId, refs: [...refs] });
        if (await experimental_copyToClipboard({ text })) composer.experimental_closePopup();
        else setNotice({ tone: 'error', text: 'Could not write to the clipboard.' });
      } catch (cause) {
        setNotice({ tone: 'error', text: message(cause) });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!catalogue.canInstall || !threadId) {
      setNotice({ tone: 'error', text: 'Install needs a thread with a checkout.' });
      return;
    }
    // `skl install --stdin` skips skl's whole-group prompt, so confirm here, as `skl-pick` does.
    if (groupRefs(refs).length > 0) setConfirming(refs);
    else await install(refs);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter that commits an IME composition must not load the cursor row.
    if (event.nativeEvent.isComposing) return;
    if (confirming) {
      event.preventDefault();
      if (event.key === 'y' || event.key === 'Y') void install(confirming);
      else setConfirming(null);
      return;
    }
    const step = onKey(state, {
      key: event.key, code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey,
    }, visible, all);
    if (!step.handled) return;
    event.preventDefault();
    setState(step.state);
    if (step.effect.kind === 'close') composer.experimental_closePopup();
    else if (step.effect.kind !== 'none') void run(step.effect.kind, step.effect.refs);
  };

  const marked = new Set(state.marked);
  const chosen = chosenRefs(state, visible, all);

  return (
    <div className="flex w-full flex-col text-sm" onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault(); event.stopPropagation();
        if (confirming) setConfirming(null); else composer.experimental_closePopup();
      }
    }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Icon name="Search" className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          aria-label="Filter skills"
          aria-controls="skl-rows"
          placeholder={catalogue ? `Filter ${all.filter(row => row.kind === 'skill').length} skills` : 'Loading skl catalogue…'}
          value={state.query}
          onChange={event => setState(previous => setQuery(previous, event.target.value))}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
        {state.marked.length > 0 ? <span className="text-xs text-muted-foreground">{state.marked.length} marked</span> : null}
      </div>
      {confirming ? (
        <div role="alert" className="border-b border-border px-3 py-2 text-xs text-foreground">
          Install whole group{groupRefs(confirming).length > 1 ? 's' : ''} {groupRefs(confirming).join(' ')} into this thread's project? y / N
        </div>
      ) : null}
      {notice ? (
        <div role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`max-h-24 overflow-y-auto whitespace-pre-wrap border-b border-border px-3 py-2 font-mono text-xs ${notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {notice.text}
        </div>
      ) : null}
      <div className="flex h-96 min-h-0">
        <div id="skl-rows" ref={listRef} role="listbox" aria-multiselectable="true" aria-label="Skills"
          className={`min-h-0 overflow-y-auto p-1 ${state.preview ? 'w-2/5 shrink-0 border-r border-border' : 'flex-1'}`}>
          {visible.map((row, index) => {
            const selected = index === Math.min(state.cursor, visible.length - 1);
            return (
              <div key={row.ref} role="option" aria-selected={selected}
                tabIndex={-1}
                className={`flex cursor-default items-baseline gap-2 rounded px-2 py-1 ${selected ? 'bg-state-active' : 'hover:bg-state-hover'}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setState(previous => ({ ...previous, cursor: index }))}
                onDoubleClick={() => void run('load', [row.ref])}>
                <span className="w-3 shrink-0 text-xs text-foreground">{marked.has(row.ref) ? '●' : ''}</span>
                {row.kind === 'folder' ? (
                  <span className="min-w-0 truncate font-medium text-foreground">{row.ref} <span className="text-xs text-muted-foreground">({row.count})</span></span>
                ) : (
                  <>
                    <span className="min-w-0 max-w-full shrink-0 truncate text-foreground">{row.ref}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{row.description}</span>
                  </>
                )}
              </div>
            );
          })}
          {catalogue && visible.length === 0 ? <div className="px-2 py-1 text-xs text-muted-foreground">No skill matches.</div> : null}
        </div>
        {state.preview ? (
          <pre className="min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-foreground">
            {preview && current && preview.ref === current.ref ? preview.text : 'Loading preview…'}
          </pre>
        ) : null}
      </div>
      <div className="border-t border-border px-3 py-1 text-2xs text-muted-foreground">
        tab mark · enter load{chosen.length > 1 ? ` ${chosen.length}` : ''} (folder = whole group) · ctrl-y copy · alt-i install · ctrl-/ preview · esc close
      </div>
    </div>
  );
}

export default definePluginApp(app => {
  app.composer.customize({
    id: POPUP_ID,
    experimental_popups: [{ id: POPUP_ID, label: 'Load skill', component: SklPopup }],
    plusMenu: [{
      id: 'open',
      label: 'Load skill…',
      icon: 'Layers',
      description: 'Pick catalogue skills with skl',
      run: ({ composer }) => { composer.experimental_openPopup(POPUP_ID); },
    }],
  });
  app.composer.experimental_registerCommand({
    id: 'pick',
    title: 'Load skill',
    defaultShortcut: { key: 's', alt: true },
    run: ({ composer }) => { composer.experimental_openPopup(POPUP_ID); },
  });
});
