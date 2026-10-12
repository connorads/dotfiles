import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_Icon as Icon, useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { Finished, rpcContract } from './contracts.ts';
import { grabInto, toggleRecording } from './actions.ts';
import { Library, useNow } from './library.tsx';
import { pill } from './src/state.ts';
import { closeDialog, dismiss, lendPreviewer, notify, openLibrary, receiveStatus, refresh, setClient, toggleLibrary, useVox, type Dialog, type Notice } from './vox-store.ts';
import './app.css';

/** The title prompt. Enter answers (empty keeps the timestamp); Esc answers null. */
function NameDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'name' }> }) {
  const element = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  useLayoutEffect(() => {
    const node = element.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  // Resolve first: closing an unanswered prompt resolves it as keep.
  const answer = (value: string | null) => { dialog.resolve(value); closeDialog(); };
  // aria-modal sets bb's `modalOpen`, so Esc discards here without also firing bb's app.back.
  return <dialog ref={element} className="vx-dialog vx-name" aria-label="Name the recording" aria-modal="true"
    onCancel={event => { event.preventDefault(); answer(null); }} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
    <form className="vx-panel vx-name-panel" onSubmit={event => { event.preventDefault(); answer(title); }}>
      <label htmlFor="vx-title"><span className="vx-live-dot" aria-hidden />{dialog.purpose === 'start' ? 'Recording. Name it (optional)' : `Rename ${dialog.name}`}</label>
      <input id="vx-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Team Alpha kickoff" />
      <span className="vx-hint">↵ {dialog.purpose === 'start' ? 'keep' : 'rename'} · esc {dialog.purpose === 'start' ? 'discard the recording' : 'leave the name'}</span>
    </form>
  </dialog>;
}

function Overlay() {
  const { dialog, notices } = useVox();
  setClient(useRpc<typeof rpcContract>());
  useRealtime('status', receiveStatus);
  // Stopping detached the transcription; this is the bell that says it ended.
  useRealtime('finished', payload => {
    const { action, name, ok, reason } = payload as Finished;
    notify(ok ? 'success' : 'error', ok ? `Transcript ready: ${name}` : reason ?? `vox ${action} failed for ${name}`, 12_000);
  });
  // Realtime is not replayed, so read the status again after a reconnect or refocus.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === 'connected' && previous.current !== 'connected') void refresh();
    previous.current = connection;
  }, [connection]);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  return <>
    {dialog?.kind === 'library' && <Library anchor={dialog.anchor} onClose={closeDialog} />}
    {dialog?.kind === 'name' && <NameDialog key="name" dialog={dialog} />}
    {notices.length > 0 && <Notices notices={notices} dialog={dialog} />}
  </>;
}

/**
 * A modal dialog sits in the top layer, above any z-index. The stack is a
 * manual popover, re-shown after each dialog or notice change, so it stays
 * above the library and the title prompt.
 */
function Notices({ notices, dialog }: { notices: readonly Notice[]; dialog: Dialog | null }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    if (node.matches(':popover-open')) node.hidePopover();
    node.showPopover();
  }, [notices, dialog]);
  return <div ref={element} popover="manual" className="vx-notices" role="status">
    {notices.map(notice => <div key={notice.id} className="vx-notice" data-tone={notice.tone}>
      <span>{notice.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(notice.id)}><Icon name="X" className="vx-icon" /></button>
    </div>)}
  </div>;
}

/** The pill: hidden while idle, like the tmux segment; a click opens the library. */
function Chip({ isCompactViewport }: PluginThreadHeaderActionProps) {
  const { status, dialog } = useVox();
  // Mounted even while hidden, so the library can open a transcript in this pane.
  const navigate = useBbNavigate();
  useEffect(() => lendPreviewer(options => navigate.experimental_openFilePreview(options)), [navigate]);
  const ticking = status?.state === 'recording' || status?.state === 'transcribing';
  const now = useNow(1000, ticking);
  const shown = status && pill(status, now / 1000);
  if (!shown) return null;
  return <button type="button" className="vx-chip" data-vox-chip data-tone={shown.tone} aria-haspopup="dialog"
    aria-expanded={dialog?.kind === 'library'} aria-label={`Vox: ${shown.label}`} title={`Vox: ${shown.label} (⌥⇧V)`} onClick={toggleLibrary}>
    <span className="vx-glyph" aria-hidden>{shown.glyph}</span>
    {!isCompactViewport || shown.tone !== 'muted' ? <span>{shown.text}</span> : null}
  </button>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'vox', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'pill', title: 'Vox recording', component: Chip });
  app.commands.register({ id: 'toggle', title: 'Vox: Start or stop recording', defaultShortcut: { key: 'v', alt: true }, run: () => { void toggleRecording(); } });
  app.commands.register({ id: 'recordings', title: 'Vox: Recordings', defaultShortcut: { key: 'v', alt: true, shift: true }, run: openLibrary });
  app.composer.experimental_registerCommand({ id: 'grab', title: 'Vox: Attach the live call so far', defaultShortcut: { key: 'y', alt: true }, run: ({ composer }) => grabInto(composer, null) });
  app.composer.experimental_registerCommand({ id: 'grab-recent', title: 'Vox: Attach the last 5 minutes of the live call', run: ({ composer }) => grabInto(composer, '5m') });
});
