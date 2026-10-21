import { useCallback, useEffect, useRef, useState } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { OpRequest, rpcContract } from './contracts.ts';
import { fetchRequestFailed, renew, useRepo } from './repo-store.ts';
import { FolderPicker } from './folder-picker.tsx';
import { RepoView } from './repo-view.tsx';
import { available } from './sync-bar.tsx';
import { message, Zoomed } from './ui.tsx';

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
  // A click morphs between sizes; the z key switches at once, like opening by shortcut.
  const [morph, setMorph] = useState(false);
  const zoom = useCallback((via: 'pointer' | 'keyboard') => {
    setMorph(via === 'pointer');
    setZoomed(current => { localStorage.setItem(zoomKey, current ? '0' : '1'); return !current; });
  }, []);
  /** Open branch picker, and how it was opened: a shortcut opens it without motion. */
  const [picker, setPicker] = useState<'closed' | 'pointer' | 'keyboard'>('closed');
  const [folders, setFolders] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const [dismissed, setDismissed] = useState<string | null>(null);
  const runOp = useCallback((request: OpRequest) => {
    if (!state.root) return Promise.resolve(false);
    setActionError(null);
    return rpc.call('run', { threadId, root: state.root, request, origin: 'user' }).then(() => true, cause => {
      if (request.kind === 'fetch') fetchRequestFailed(threadId, state.root!, cause);
      else setActionError(message(cause));
      return false;
    });
  }, [rpc, threadId, state.root]);
  const cancelOp = useCallback(() => { if (!state.root) return; rpc.call('cancel', { threadId, root: state.root }).catch(cause => setActionError(message(cause))); }, [rpc, threadId, state.root]);


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
    else if (event.key === 'z') { event.preventDefault(); zoom('keyboard'); }
    else if (event.key === 'b' && repo) { event.preventDefault(); setPicker('keyboard'); }
    else if (event.key === 'q') { event.preventDefault(); onClose(); }
    // The lazygit plugin listens; without it the key does nothing.
    else if (event.key === 'l' && !state.selected) { event.preventDefault(); onClose(); window.dispatchEvent(new CustomEvent('lazygit:open', { detail: { threadId } })); }
    else if (repo && (event.key === 'P' || event.key === 'p' || event.key === 'f')) {
      const op = event.key === 'P' ? 'push' : event.key === 'p' ? 'pull' : 'fetch';
      event.preventDefault();
      if (available(repo, state.op)[op].enabled) void runOp({ kind: op });
    }
  }

  const repo = state.snapshot?.kind === 'none' ? null : state.snapshot;
  return <ChipPopover ref={dialog} className="gg-dialog" panelClassName="gg-panel" aria-label="Git status" onKeyDown={keyboard}
    trigger={() => chip(threadId)} anchor={anchor} width={640} instant={instant} place={zoomed ? placeZoomed : undefined}
    data-zoomed={zoomed || undefined} data-morph={morph || undefined} onClose={onClose}>
    {folders ? <FolderPicker threadId={threadId} onClose={() => setFolders(false)} onSelected={() => {
      opened.current = false; setPicker('closed'); setDismissed(null); setActionError(null);
      void renew(threadId).then(() => setFolders(false));
    }} /> : repo ? <Zoomed.Provider value={zoomed}><RepoView key={state.root} onFolders={() => setFolders(true)} repo={repo} threadId={threadId} state={state} actionError={actionError}
      dismissed={dismissed} onDismiss={setDismissed} onRun={runOp} onCancel={cancelOp}
      picker={picker} onPicker={setPicker} onZoom={() => zoom('pointer')} onClose={onClose} /></Zoomed.Provider>
      : <div className="gg-blank">
        {state.error ? <><Icon name="AlertTriangle" className="gg-blank-icon gg-danger" /><strong>Could not read git status</strong><span>{state.error}</span><button type="button" className="gg-ghost" onClick={() => setFolders(true)}>Choose repository</button></>
          : state.snapshot?.kind === 'none' ? <><Icon name="FolderUnknown" className="gg-blank-icon" /><strong>Not a git repository</strong><span>This thread's checkout has no repository.</span><button type="button" className="gg-ghost" onClick={() => setFolders(true)}>Choose repository</button></>
          : <><span className="gg-spinner" /><span>Reading repository…</span></>}
      </div>}
  </ChipPopover>;
}
