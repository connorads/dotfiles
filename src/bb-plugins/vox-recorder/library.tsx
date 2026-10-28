import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { experimental_copyToClipboard, experimental_Icon as Icon, useComposer } from '@get-bb/plugin-sdk/app';
import type { PreviewDto, RecordingDto } from './contracts.ts';
import { discardLive, grabInto, insertRecording, nameLive, stop } from './actions.ts';
import { libraryKey, type LetterAction } from './src/keys.ts';
import { formatBytes, matches, readable, when } from './src/library.ts';
import { humanAge, pill } from './src/state.ts';
import { chipSelector, message, notify, previewer, rpc, useVox, type Anchor } from './vox-store.ts';

const chip = () => document.querySelector<HTMLElement>(chipSelector);

export function useNow(intervalMs: number, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

/** A y/n question names its target when asked, so moving the selection before `y` cannot retarget it. */
type Confirm = { action: 'delete' | 'reclaim'; name: string; label: string } | { action: 'discard'; label: string } | null;

export function Library({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  const composer = useComposer();
  const { status } = useVox();
  const filterInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [recordings, setRecordings] = useState<RecordingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; title: string } | null>(null);
  const [detail, setDetail] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const recording = status?.state === 'recording' ? status.recording : null;
  const now = useNow(1000, recording !== null);

  // Runs after ChipPopover's showModal(), which focuses the first control.
  useLayoutEffect(() => { filterInput.current?.focus(); }, []);

  const load = useCallback(async () => {
    try { setRecordings(await rpc().call('list', {})); setError(null); } catch (cause) { setError(message(cause)); }
  }, []);
  // Opening the library is looking: it clears the ready and empty pill.
  useEffect(() => { void rpc().call('markSeen', {}).catch(() => {}); }, []);
  // Read on open, and again when a status signal says a kind may have changed.
  useEffect(() => { void load(); }, [status?.state, status?.jobs.count, load]);

  const visible = useMemo(() => (recordings ?? []).filter(r => matches(r, filter)), [recordings, filter]);
  const current = visible.find(r => r.name === selected) ?? visible[0] ?? null;
  useEffect(() => {
    if (!current) { setPreview(null); return; }
    let live = true;
    rpc().call('preview', { name: current.name }).then(next => { if (live) setPreview(next); }, cause => { if (live) setPreview({ kind: 'none', files: [message(cause)] }); });
    return () => { live = false; };
  }, [current?.name, current?.kind]);

  const insert = (r: RecordingDto) => {
    if (readable(r)) insertRecording(composer, r.name);
    else notify('error', r.kind === 'empty' ? `${r.name} transcribed to nothing.` : `${r.name} has no transcript yet.`);
  };
  const act = useCallback(async (run: () => Promise<unknown>, done?: string) => {
    try { await run(); if (done) notify('success', done); } catch (cause) { notify('error', message(cause)); }
    setConfirm(null);
    void load();
  }, [load]);

  const copy = (name: string) => act(async () => {
    const { text } = await rpc().call('transcript', { name });
    if (!await experimental_copyToClipboard({ text })) throw new Error('Could not copy the transcript.');
  }, 'Copied transcript');
  const openFile = (name: string) => act(async () => {
    const { hostId, path } = await rpc().call('location', { name });
    const open = previewer();
    if (!open) throw new Error('Open a thread to preview a transcript.');
    if (!open({ target: { kind: 'host', hostId, path }, location: null })) throw new Error('BB could not open the transcript.');
    onClose();
  });
  const runConfirmed = () => {
    if (confirm?.action === 'delete') { const { name } = confirm; return act(() => rpc().call('remove', { names: [name] }), `Deleted ${name}`); }
    if (confirm?.action === 'reclaim') { const { name } = confirm; return act(() => rpc().call('reclaim', { names: [name] }), `Reclaimed audio from ${name}`); }
    if (confirm?.action === 'discard') return act(discardLive);
  };

  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const focus = event.target === filterInput.current ? 'filter' : event.target === list.current ? 'list' : 'other';
    const decided = libraryKey({
      key: event.key, focus, modified: event.metaKey || event.ctrlKey || event.altKey, renaming: renaming !== null,
      confirming: confirm !== null, hasCurrent: current !== null,
    });
    if (!decided) return;
    event.preventDefault();
    switch (decided.kind) {
      case 'move': {
        const index = current ? visible.indexOf(current) : -1;
        setSelected(visible[Math.min(visible.length - 1, Math.max(0, index + decided.step))]?.name ?? null);
        // Leave the filter, so c, e, r and the other letters act rather than type.
        if (focus === 'filter') list.current?.focus();
        return;
      }
      case 'insert': if (current) insert(current); return;
      case 'confirm': void runConfirmed(); return;
      case 'dismiss-confirm': setConfirm(null); return;
      case 'close': onClose(); return;
      case 'letter': if (current) letter(decided.action, current); return;
    }
  }

  function letter(action: LetterAction, r: RecordingDto) {
    switch (action) {
      case 'copy': void copy(r.name); return;
      case 'open': void openFile(r.name); return;
      case 'rename': setRenaming({ name: r.name, title: r.title === 'untitled' ? '' : r.title }); return;
      case 'reveal': void act(() => rpc().call('reveal', { name: r.name })); return;
      case 'retranscribe': void act(() => rpc().call('transcribe', { names: [r.name] }), `Retranscribing ${r.name}…`); return;
      case 'delete': setConfirm({ action: 'delete', name: r.name, label: `Delete ${r.name}, transcript included?` }); return;
      case 'reclaim': setConfirm({ action: 'reclaim', name: r.name, label: `Delete the audio of ${r.name}, keeping the transcript?` }); return;
      case 'filter': filterInput.current?.focus(); return;
    }
  }

  const saveName = () => {
    if (renaming === null) return;
    const { name, title } = renaming;
    setRenaming(null);
    void act(async () => {
      const renamed = await rpc().call('rename', { name, title });
      if (!renamed.ok) throw new Error(renamed.reason);
      setSelected(renamed.path.split('/').at(-1) ?? null);
    }, 'Renamed');
  };

  const livePill = status ? pill(status, now / 1000) : null;
  return <ChipPopover panelClassName="vx-library" aria-label="Vox recordings" onKeyDown={keyboard} trigger={chip} anchor={anchor} width={820}
    onClose={onClose} onEscape={() => { if (confirm) setConfirm(null); else if (renaming !== null) setRenaming(null); else onClose(); }}>
    {recording && <section className="vx-live" aria-label="Live recording">
      <span className="vx-live-dot" aria-hidden />
      <strong>Recording</strong>
      <span className="vx-muted">{recording.dir.split('/').at(-1)} · {livePill?.text ?? humanAge(0)}</span>
      <span className="vx-spacer" />
      <button type="button" onClick={() => { void grabInto(composer, null); onClose(); }} title="Transcribe the call so far into the composer (⌥Y)">Grab so far</button>
      <button type="button" onClick={() => { void grabInto(composer, '5m'); onClose(); }}>Last 5 min</button>
      <button type="button" onClick={() => { onClose(); void nameLive(); }}>Name…</button>
      <button type="button" onClick={() => { void stop(); }}><Icon name="Square" className="vx-icon" />Stop</button>
      <button type="button" className="vx-danger" onClick={() => setConfirm({ action: 'discard', label: 'Discard this recording without transcribing?' })}>Discard</button>
    </section>}
    <header className="vx-head">
      <Icon name="Search" className="vx-icon vx-muted" />
      <input ref={filterInput} className="vx-filter" placeholder="Filter, ↓ for the list" value={filter} aria-label="Filter recordings"
        onChange={event => setFilter(event.target.value)} />
      <span className="vx-hint">↵ insert · c copy · e open · r rename · o reveal · t retranscribe · d delete · x reclaim · / filter</span>
    </header>
    {confirm && <div className="vx-confirm" role="alertdialog">
      <span>{confirm.label}</span>
      <button type="button" className="vx-danger" onClick={() => { void runConfirmed(); }}>Yes (y)</button>
      <button type="button" onClick={() => setConfirm(null)}>No (n)</button>
    </div>}
    <div className="vx-actions">
      <button type="button" className="vx-list-back" onClick={() => setDetail(false)}>Recordings</button>
      <button type="button" disabled={!current || !readable(current)} onClick={() => current && insert(current)}>Insert transcript</button>
      <details><summary>Recording actions</summary><div className="vx-action-menu">
        {(['copy', 'open', 'rename', 'reveal', 'retranscribe', 'delete', 'reclaim'] as const).map(action => <button type="button" key={action} disabled={!current} onClick={() => current && letter(action, current)}>{({ copy: 'Copy transcript', open: 'Open transcript', rename: 'Rename', reveal: 'Reveal files', retranscribe: 'Retranscribe', delete: 'Delete recording', reclaim: 'Delete audio' })[action]}</button>)}
      </div></details>
      <button type="button" onClick={onClose}>Close</button>
    </div>
    {renaming !== null && <form className="vx-actions" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); } }} onSubmit={event => { event.preventDefault(); saveName(); }}>
      <input className="vx-rename" autoFocus aria-label="New title" value={renaming.title} onChange={event => setRenaming({ ...renaming, title: event.target.value })} />
      <button type="submit">Save name</button><button type="button" onClick={() => setRenaming(null)}>Cancel rename</button>
    </form>}
    <div className="vx-body" data-detail={detail}>
      <ul ref={list} tabIndex={0} className="vx-list" role="listbox" aria-label="Recordings">
        {error && <li className="vx-blank vx-error">{error}</li>}
        {!error && recordings === null && <li className="vx-blank">Reading recordings…</li>}
        {recordings !== null && visible.length === 0 && <li className="vx-blank">{recordings.length ? 'Nothing matches.' : 'No recordings yet. ⌥V starts one.'}</li>}
        {visible.map(r => <li key={r.name} role="option" aria-selected={r === current} className="vx-row" data-selected={r === current}
          onClick={() => { setSelected(r.name); setDetail(true); list.current?.focus(); }} onDoubleClick={() => insert(r)}>
          <span className="vx-title">{r.title}</span>
          <span className="vx-kind" data-kind={r.kind}>{r.kind}</span>
          <span className="vx-muted vx-when">{when(r.name)}</span>
          <span className="vx-muted vx-size">{formatBytes(r.bytes)}</span>
        </li>)}
      </ul>
      <div className="vx-preview" aria-live="polite">
        {current && <strong>{current.title}</strong>}
        {!preview ? null
          : preview.kind === 'transcript' ? <pre>{preview.text}{preview.truncated ? '\n…' : ''}</pre>
          : preview.kind === 'empty' ? <><strong>Transcribed to nothing: no speech recognised.</strong><pre>{preview.log}</pre></>
          : preview.kind === 'transcribing' ? <><strong>Transcribing…</strong><pre>{preview.log}</pre></>
          : <><strong>No transcript yet.</strong><pre>{preview.files.join('\n')}</pre></>}
      </div>
    </div>
  </ChipPopover>;
}
