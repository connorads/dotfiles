import { useEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_copyToClipboard, useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import { z } from 'zod';
import { draftSchema, type Draft, type rpcContract } from './contracts.ts';
import './app.css';

function saveRecovery(key: string, draft: Draft | null) {
  try { if (draft) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); } catch { /* Server autosave remains available. */ }
}

const seedSchema = z.object({ text: z.string().max(16000) });
export function DraftEditor({ threadId, seed }: { threadId: string; seed?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading…');
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState(seed);
  const local = useRef({ text: '', revision: 0, dirty: false, blocked: false });
  const remote = useRef<Draft>({ text: '', revision: 0 });
  const history = useRef<string[]>([]);
  const storageKey = `message-drafts:${threadId}`;
  useEffect(() => { setCandidate(seed); }, [seed]);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let loaded = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!loaded) {
          const saved = await rpc.call('read', { threadId });
          if (disposed) return;
          remote.current = saved;
          let backup: Draft | null = null;
          try { const parsed = draftSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); if (parsed.success) backup = parsed.data; } catch { /* Storage may be unavailable. */ }
          const restored = backup && backup.text !== saved.text ? backup : null;
          local.current = { ...(restored ?? saved), dirty: restored !== null, blocked: restored !== null && restored.revision !== saved.revision };
          setText(local.current.text); setConflict(local.current.blocked); setReady(true);
          setStatus(local.current.blocked ? 'Saved draft changed. Your local edits are kept.' : restored ? 'Restored local edits' : 'Saved');
          loaded = true;
        } else if (local.current.dirty && !local.current.blocked) {
          const snapshot = { text: local.current.text, revision: local.current.revision };
          const result = await rpc.call('write', { threadId, ...snapshot });
          if (disposed) return;
          if (!result.ok) {
            remote.current = await rpc.call('read', { threadId });
            local.current.blocked = true; setConflict(true); setStatus('Draft changed elsewhere. Your edits are kept.');
          } else {
            local.current.revision = result.revision;
            local.current.dirty = local.current.text !== snapshot.text;
            saveRecovery(storageKey, local.current.dirty ? { text: local.current.text, revision: result.revision } : null);
            setStatus(local.current.dirty ? 'Saving…' : 'Saved');
          }
        } else if (!local.current.dirty) {
          const saved = await rpc.call('read', { threadId });
          if (disposed || local.current.dirty) return;
          remote.current = saved;
          if (saved.revision !== local.current.revision) {
            history.current.push(local.current.text);
            local.current = { ...saved, dirty: false, blocked: false }; setText(saved.text); setStatus('Updated by agent or another window');
          }
        }
      } catch (cause) { if (!disposed) setStatus(`Not saved: ${cause instanceof Error ? cause.message : String(cause)}`); }
      finally { busy = false; }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 800);
    return () => { disposed = true; clearInterval(timer); };
  }, [rpc, threadId, storageKey]);

  const edit = (value: string) => {
    history.current.push(local.current.text);
    local.current.text = value; local.current.dirty = true; setText(value);
    try { localStorage.setItem(storageKey, JSON.stringify({ text: value, revision: local.current.revision })); }
    catch { setStatus('Local recovery unavailable. Waiting for server autosave.'); return; }
    setStatus(local.current.blocked ? 'Your edits are kept. Resolve the conflict below.' : 'Saving…');
  };
  return <section className="message-drafts">
    <div className="message-drafts-bar"><strong>Message draft</strong><small role="status">{status}</small></div>
    {candidate !== undefined && <div className="message-drafts-import"><p>Use the selected message as this draft?</p><button disabled={!ready || conflict} onClick={() => { edit(candidate); setCandidate(undefined); }}>Use message</button><button onClick={() => setCandidate(undefined)}>Dismiss</button></div>}
    <textarea aria-label="Message draft" placeholder="Write here, or ask the agent to draft a message…" disabled={!ready} maxLength={16000} value={text} onChange={event => edit(event.target.value)} />
    {conflict && <div role="alert"><p>Your edits have not replaced the saved draft. Copy them before loading the saved version.</p><button onClick={() => { const saved = remote.current; history.current.push(local.current.text); local.current = { ...saved, dirty: false, blocked: false }; setText(saved.text); setConflict(false); setStatus('Saved version loaded'); try { localStorage.removeItem(storageKey); } catch { /* Recovery is optional. */ } }}>Load saved version</button></div>}
    <div className="message-drafts-bar"><small>{text.length} / 16000 characters</small><div><button disabled={!ready || history.current.length === 0} onClick={() => { const previous = history.current.pop(); if (previous !== undefined) { const remaining = [...history.current]; edit(previous); history.current = remaining; } }}>Undo</button><button disabled={!ready} onClick={() => { void experimental_copyToClipboard({ text }).then(ok => setStatus(ok ? 'Copied' : 'Copy failed. Select the text and copy it.'), () => setStatus('Copy failed. Select the text and copy it.')); }}>Copy message</button></div></div>
    <small>Edit here. Ask for revisions in chat. Copy when ready.</small>
  </section>;
}

export default definePluginApp(app => {
  app.slots.messageDirective({ id: 'message-draft', component: () => {
    const navigate = useBbNavigate();
    const [error, setError] = useState(false);
    return <div className="message-drafts-link"><button onClick={() => setError(!navigate.openThreadPanel({ actionId: 'draft' }))}>Open message draft</button>
      {error && <small role="alert">Open this conversation, then try again.</small>}</div>;
  } });
  app.slots.threadPanelAction({ id: 'draft', title: 'Message draft', icon: 'Pencil', layout: 'flush',
    component: ({ threadId, params }) => { const parsed = seedSchema.safeParse(params); return <DraftEditor key={threadId} threadId={threadId} seed={parsed.success ? parsed.data.text : undefined} />; } });
  app.commands.register({ id: 'open', title: 'Open message draft', isAvailable: ({ threadId }) => threadId !== null,
    run: context => { context.openPanel({ actionId: 'draft' }); } });
  app.slots.messageAction({ id: 'edit', title: 'Edit as message draft', icon: 'Pencil',
    run: context => { context.openPanel({ actionId: 'draft', params: { text: (context.selectedText ?? context.message.text).slice(0, 16000) } }); } });
});
