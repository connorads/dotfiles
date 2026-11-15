import { useCallback, useEffect, useRef, useState } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { OpRequest, rpcContract } from './contracts.ts';
import { subjectProject } from './contracts.ts';
import { fetchRequestFailed, renew, reported, useRepo } from './repo-store.ts';
import { FolderPicker } from './folder-picker.tsx';
import { RepoView, type ActionError } from './repo-view.tsx';
import { available, describe } from './sync-bar.tsx';
import { message, Zoomed } from './ui.tsx';
import { refusedBy } from './src/ops.ts';

export type Anchor = { top: number; right: number; bottom: number; left: number } | null;

const zoomKey = 'git-glance:zoomed';
export const chip = (threadId: string) => document.querySelector<HTMLElement>(`[data-git-glance="${CSS.escape(threadId)}"]`);

/** Zoomed: a large centred view with room for side-by-side diffs. */
function placeZoomed() {
  const width = Math.min(1240, window.innerWidth - 48);
  return { width, top: Math.round(window.innerHeight * 0.04), left: (window.innerWidth - width) / 2, origin: 'top center' };
}

export function GitPopover({ threadId, anchor, instant, onClose }: { threadId: string; anchor: Anchor; instant: boolean; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const state = useRepo(threadId, rpc);
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(() => localStorage.getItem(zoomKey) === '1');
  // A click morphs between sizes; keyboard shortcuts switch at once.
  const [morph, setMorph] = useState(false);
  const zoom = useCallback((via: 'pointer' | 'keyboard') => {
    setMorph(via === 'pointer');
    setZoomed(current => { localStorage.setItem(zoomKey, current ? '0' : '1'); return !current; });
  }, []);
  /** Open branch picker, and how it was opened: a shortcut opens it without motion. */
  const [picker, setPicker] = useState<'closed' | 'pointer' | 'keyboard'>('closed');
  const [folders, setFolders] = useState(false);
  /** A failed or refused action; a refusal holds while the operation that blocked it runs. */
  const [actionError, setActionError] = useState<ActionError & { blocker?: string } | null>(null);

  // Once data arrives: focus the first row for the arrow keys, and fetch so the
  // pull count is current. The server skips the fetch if one ran recently.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state.snapshot) return;
    opened.current = true;
    dialog.current?.querySelector<HTMLElement>('[data-row]')?.focus({ preventScroll: true });
    if (state.root && state.snapshot.kind !== 'none' && state.snapshot.remotes.length > 0) {
      rpc.call('run', { threadId, root: state.root, request: { kind: 'fetch' }, origin: 'auto' }).catch(cause => fetchRequestFailed(threadId, state.root!, cause));
    }
  }, [state.snapshot, state.root, rpc, threadId]);
  // A focused control that is removed or disabled, such as a discarded row or a sync button, drops focus to the
  // page or the dialog, where the row keys stop working. Hand focus to its form, or to the row now in its place.
  useEffect(() => {
    const root = dialog.current;
    if (!root) return;
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-row]'));
    let last: { element: HTMLElement; row: number } | null = null;
    const track = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target === root) return;
      // The row at or before the focused control, so a control inside a row maps to that row.
      last = { element: target, row: rows().filter(row => row === target || row.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).length - 1 };
    };
    let frame = 0;
    const rescue = () => {
      cancelAnimationFrame(frame);
      // A frame later, so a view that places focus itself, such as the commit form, goes first.
      frame = requestAnimationFrame(() => {
        const active = root.ownerDocument.activeElement;
        // The browser moves focus off a disabled control only after this frame, so that control still counts as lost.
        if (!root.open || !last || (active && active !== root.ownerDocument.body && active !== root && active !== last.element)) return;
        if (last.element.isConnected && !last.element.matches(':disabled')) return;
        // A form that holds focus while its field is disabled, such as the commit form, takes it back itself;
        // a disabled sync button hands focus to another in its group.
        const holder = last.element.isConnected ? last.element.closest<HTMLElement>('form[tabindex="-1"]')
          ?? last.element.closest('[role="group"]')?.querySelector<HTMLElement>('button:not(:disabled)') : null;
        if (holder) { holder.focus({ preventScroll: true }); return; }
        const list = rows();
        list[Math.max(0, Math.min(last.row, list.length - 1))]?.focus({ preventScroll: true });
      });
    };
    const observer = new MutationObserver(rescue);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    root.addEventListener('focusin', track);
    return () => { observer.disconnect(); root.removeEventListener('focusin', track); cancelAnimationFrame(frame); };
  }, []);
  const [dismissed, setDismissed] = useState<string | null>(null);
  /** A request sent to the server whose reply has not arrived. */
  const [sending, setSending] = useState<OpRequest | null>(null);
  const latest = useRef<OpRequest | null>(null);
  const runOp = useCallback((request: OpRequest) => {
    const root = state.root;
    if (!root) return Promise.resolve(false);
    setActionError(null);
    latest.current = request;
    setSending(request);
    const sent = () => { if (latest.current === request) { latest.current = null; setSending(null); } };
    return rpc.call('run', { threadId, root, request, origin: 'user' }).then(({ op }) => {
      sent();
      const blocker = refusedBy(op, request);
      if (blocker) {
        const { name } = describe(blocker.request);
        setActionError(reported(threadId, root, blocker) ? { refused: true, text: `${name} is running. Try again when it finishes.`, blocker: blocker.id } : { refused: true, text: `${name} was running. Try again.` });
        return false;
      }
      if (op) reported(threadId, root, op);
      return true;
    }, cause => {
      sent();
      if (request.kind === 'fetch') fetchRequestFailed(threadId, root, cause);
      else setActionError({ refused: false, text: `${describe(request).name} failed: ${message(cause)}` });
      return false;
    });
  }, [rpc, threadId, state.root]);
  const cancelOp = useCallback(() => { if (!state.root) return; rpc.call('cancel', { threadId, root: state.root }).catch(cause => setActionError({ refused: false, text: message(cause) })); }, [rpc, threadId, state.root]);
  // A refusal holds only while its blocker runs.
  const shownError = actionError?.blocker && !(state.op?.id === actionError.blocker && state.op.status === 'running') ? null : actionError;


  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (folders || (event.target instanceof HTMLElement && event.target.closest('[contenteditable=true]')) || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const move = (step: number) => {
      event.preventDefault();
      const next = rows[current < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, current + step))];
      next?.focus(); next?.scrollIntoView({ block: 'nearest' });
    };
    if (event.key === 'ArrowDown' || event.key === 'j') move(1);
    else if (event.key === 'ArrowUp' || event.key === 'k') move(-1);
    else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); void renew(threadId); }
    else if (event.key === 'o' && repo) { event.preventDefault(); setFolders(true); }
    else if (event.key === '+' || event.key === '_') { event.preventDefault(); if ((event.key === '+') !== zoomed) zoom('keyboard'); }
    else if (event.key === 'c' && repo && !event.repeat) {
      event.preventDefault();
      dialog.current?.querySelector<HTMLButtonElement>('.gg-composer > button[aria-expanded="false"]')?.click();
    }
    else if (event.key === 'b' && repo) { event.preventDefault(); setPicker('keyboard'); }
    else if (event.key === 'q') { event.preventDefault(); onClose(); }
    // The lazygit plugin listens; without it the key does nothing.
    else if (event.key === 'l' && state.root && repo && !subjectProject(threadId)) { event.preventDefault(); onClose(); window.dispatchEvent(new CustomEvent('lazygit:open', { detail: { threadId, cwd: state.root } })); }
    else if (repo && (event.key === 'P' || event.key === 'p' || event.key === 'f')) {
      const op = event.key === 'P' ? 'push' : event.key === 'p' ? 'pull' : 'fetch';
      event.preventDefault();
      if (!sending && available(repo, state.op)[op].enabled) void runOp({ kind: op });
    }
  }

  const repo = state.snapshot?.kind === 'none' ? null : state.snapshot;
  /** Back to the repository view, with focus on the control that opened the folder browser. */
  const backToGit = () => {
    setFolders(false);
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('[data-folders-trigger]')?.focus({ preventScroll: true }));
  };
  const selected = () => {
    opened.current = false; setPicker('closed'); setDismissed(null); setActionError(null);
    // A request still in flight belongs to the previous repository.
    latest.current = null; setSending(null);
    void renew(threadId).then(() => setFolders(false));
  };
  return <ChipPopover ref={dialog} className="gg-dialog" panelClassName="gg-panel" aria-label="Git status" onKeyDown={keyboard}
    trigger={() => chip(threadId)} anchor={anchor} width={640} instant={instant} place={zoomed ? placeZoomed : undefined}
    data-zoomed={zoomed || undefined} data-morph={morph || undefined} onClose={onClose} onEscape={folders ? backToGit : undefined}>
    {folders ? <FolderPicker threadId={threadId} onClose={backToGit} onSelected={selected} />
      : state.snapshot?.kind === 'none' && !state.error ? <FolderPicker threadId={threadId} embedded={!state.selected} onSelected={selected} />
      : repo ? <Zoomed.Provider value={zoomed}><RepoView key={state.root} onFolders={() => setFolders(true)} repo={repo} threadId={threadId} state={state} actionError={shownError}
      dismissed={dismissed} onDismiss={setDismissed} onDismissAction={() => setActionError(null)} sending={sending} onRun={runOp} onCancel={cancelOp}
      picker={picker} onPicker={setPicker} onZoom={() => zoom('pointer')} onClose={onClose} /></Zoomed.Provider>
      : <div className="gg-blank">
        {state.error ? <><Icon name="AlertTriangle" className="gg-blank-icon gg-danger" /><strong>Could not read git status</strong><span>{state.error}</span><button type="button" className="gg-ghost" onClick={() => setFolders(true)}>Choose repository</button></>
          : <><span className="gg-spinner" /><span>Reading repository…</span></>}
      </div>}
  </ChipPopover>;
}
