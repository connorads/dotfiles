import { useEffect, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { CommitReview, OpRequest, OpState, rpcContract } from './contracts.ts';
import { plural } from './src/format.ts';
import { message } from './ui.tsx';

export function CommitComposer({ threadId, repository, branch, op, onRun, onCancel }: {
  threadId: string; repository: string; branch: string; op: OpState | null;
  onRun: (request: OpRequest) => Promise<boolean>; onCancel: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<CommitReview | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generation = useRef<string | null>(null);
  const reviewVersion = useRef(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  /** Returns focus to the toggle when the form takes it away, so the pop-up's keys keep working. */
  const restoreFocus = () => {
    const button = toggle.current;
    const active = button?.ownerDocument.activeElement;
    if (button && (!active || active === button.ownerDocument.body || form.current?.contains(active))) button.focus({ preventScroll: true });
  };
  const invalidate = () => {
    reviewVersion.current++;
    const requestId = generation.current;
    generation.current = null;
    setGenerating(false);
    if (requestId) void rpc.call('cancelMessage', { threadId, requestId }).catch(() => {});
  };
  const close = () => { restoreFocus(); invalidate(); setOpen(false); };
  useEffect(() => () => { invalidate(); }, [threadId, repository]);
  const draftKey = review ? `git-glance:commit:${review.draftKey}` : null;
  const busy = op?.status === 'running';
  // The form holds focus while the index is read, so typed text never reaches the
  // pop-up's row keys (d discards); the textarea takes it once it can be edited.
  /** The caret has been placed since the form opened; later returns keep the user's caret. */
  const placed = useRef(false);
  useEffect(() => { placed.current = false; if (open) form.current?.focus({ preventScroll: true }); }, [open]);
  // Also after a generation ends or is cancelled, which takes focus away from the textarea.
  useEffect(() => {
    const area = textarea.current;
    if (!open || !review || busy || generating || !area || area.disabled) return;
    const active = area.ownerDocument.activeElement;
    if (!active || active === area.ownerDocument.body || active === form.current) {
      area.focus({ preventScroll: true });
      // A kept draft continues at its end, not before the subject.
      if (!placed.current) area.setSelectionRange(area.value.length, area.value.length);
    }
    placed.current = true;
  }, [open, review, busy, generating]);
  const refresh = () => {
    invalidate();
    const version = reviewVersion.current;
    setError(null);
    setReview(null);
    rpc.call('review', { threadId }).then(value => {
      if (version !== reviewVersion.current) return;
      setReview(value);
      setDraft(localStorage.getItem(`git-glance:commit:${value.draftKey}`) ?? '');
    }, cause => { if (version === reviewVersion.current) setError(message(cause)); });
  };
  useEffect(() => {
    if (op?.request.kind !== 'create-commit' || op.status === 'running') return;
    const wasSubmitted = submitted.current;
    submitted.current = false;
    setPending(false);
    const signature = JSON.stringify([op.request.message, op.request.head, op.request.index]);
    const matches = draftKey && localStorage.getItem(`${draftKey}:pending`) === signature;
    if (matches) localStorage.removeItem(`${draftKey}:pending`);
    if (op.status === 'succeeded' && matches && localStorage.getItem(draftKey) === op.request.message) { localStorage.removeItem(draftKey); setDraft(''); restoreFocus(); setOpen(false); }
    else if (wasSubmitted) refresh();
  }, [op, draftKey]);
  const generate = async () => {
    if (generation.current || busy || pending || !review || review.blocked || !draftKey) return;
    const requestId = crypto.randomUUID();
    const original = localStorage.getItem(draftKey);
    generation.current = requestId;
    setGenerating(true);
    setError(null);
    try {
      const result = await rpc.call('generateMessage', { threadId, requestId, head: review.head, index: review.index, draftKey: review.draftKey });
      if (generation.current !== requestId || localStorage.getItem(draftKey) !== original) return;
      setDraft(result.message);
      localStorage.setItem(draftKey, result.message);
    } catch (cause) {
      if (generation.current === requestId) setError(message(cause));
    } finally {
      if (generation.current === requestId) { generation.current = null; setGenerating(false); }
    }
  };
  const submit = () => {
    if (generation.current || submitted.current || busy || !review || review.blocked || !draft.split('\n')[0]?.trim()) return;
    submitted.current = true;
    setPending(true);
    if (draftKey) localStorage.setItem(`${draftKey}:pending`, JSON.stringify([draft, review.head, review.index]));
    void onRun({ kind: 'create-commit', message: draft, head: review.head, index: review.index }).then(accepted => {
      if (accepted) return;
      submitted.current = false;
      setPending(false);
      if (draftKey) localStorage.removeItem(`${draftKey}:pending`);
    });
  };
  return <div className="gg-composer">
    <button ref={toggle} type="button" className="gg-ghost" aria-expanded={open} title="Commit staged changes (c)" disabled={busy} onClick={() => { if (open) close(); else { setOpen(true); refresh(); } }}>Commit staged changes</button>
    {open && <form ref={form} tabIndex={-1} aria-label="Commit staged changes" onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter' && event.target instanceof HTMLTextAreaElement && !event.shiftKey && !event.repeat && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
    }}>
      <p>{repository} · {branch} · {review ? `${plural(review.count, 'staged file')}` : 'Reading complete index…'}</p>
      <p>Enter commits. Shift+Enter inserts a newline.</p>
      <p>Commits the complete index, including files staged elsewhere. Unstaged edits stay outside the commit.</p>
      <label>Commit subject and optional body<textarea ref={textarea} rows={5} maxLength={65536} value={draft} disabled={busy || !review}
        placeholder={'Subject\n\nOptional body'} onChange={event => { const value = event.target.value; invalidate(); setDraft(value); if (draftKey) localStorage.setItem(draftKey, value); }} /></label>
      {error && <p role="alert">{error}</p>}
      {review?.blocked && <p role="status">{review.blocked}</p>}
      <div className="gg-commit-actions">
      <button type="submit" className="gg-commit-submit" disabled={busy || pending || generating || !review || !!review.blocked || !draft.split('\n')[0]?.trim()}>Commit complete staged index</button>
      <button type="button" className="gg-ghost" disabled={busy || pending || generating || !review || !!review.blocked} onClick={() => { void generate(); }}>{generating ? 'Generating message…' : 'Generate message'}</button>
      {generating && <button type="button" className="gg-ghost" onClick={invalidate}>Cancel generation</button>}
      {busy && <button type="button" className="gg-ghost" onClick={onCancel}>Cancel operation</button>}
      <button type="button" className="gg-ghost" disabled={busy || pending} onClick={refresh}>Review index again</button>
      <button type="button" className="gg-ghost" onClick={close}>Close and keep draft</button>
      </div>
    </form>}
  </div>;
}
