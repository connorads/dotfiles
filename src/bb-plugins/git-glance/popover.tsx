import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { OpRequest, rpcContract } from './contracts.ts';
import { renew, useRepo } from './repo-store.ts';
import { RepoView } from './repo-view.tsx';
import { available } from './sync-bar.tsx';
import { message, Zoomed } from './ui.tsx';

const popoverWidth = 640;
const margin = 12;
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;

const zoomedWidth = 1240;
const zoomKey = 'git-glance:zoomed';

function place(anchor: Anchor, zoomed: boolean) {
  if (zoomed) {
    const width = Math.min(zoomedWidth, window.innerWidth - margin * 4);
    return { width, top: Math.round(window.innerHeight * 0.04), left: (window.innerWidth - width) / 2, origin: 'top center' };
  }
  const width = Math.min(popoverWidth, window.innerWidth - margin * 2);
  if (!anchor) return { width, top: Math.round(window.innerHeight * 0.1), left: (window.innerWidth - width) / 2, origin: 'top center' };
  const left = Math.min(Math.max(margin, anchor.right - width), window.innerWidth - width - margin);
  return { width, top: anchor.bottom + 8, left, origin: `${anchor.right - left}px 0` };
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
  const [position, setPosition] = useState(() => place(anchor, zoomed));
  /** Open branch picker, and how it was opened: a shortcut opens it without motion. */
  const [picker, setPicker] = useState<'closed' | 'pointer' | 'keyboard'>('closed');
  const [actionError, setActionError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const resize = () => {
      const chip = document.querySelector(`[data-git-glance="${CSS.escape(threadId)}"]`)?.getBoundingClientRect();
      setPosition(place(chip ?? anchor, zoomed));
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [threadId, anchor, zoomed]);
  // Once data arrives: focus the first row for the arrow keys, and fetch so the
  // pull count is current. The server skips the fetch if one ran recently.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state.snapshot) return;
    opened.current = true;
    dialog.current?.querySelector<HTMLElement>('[data-row]')?.focus({ preventScroll: true });
    if (state.snapshot.kind !== 'none' && state.snapshot.remotes.length > 0) {
      rpc.call('run', { threadId, request: { kind: 'fetch' }, origin: 'auto' }).catch(() => {});
    }
  }, [state.snapshot, rpc, threadId]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const runOp = useCallback((request: OpRequest) => {
    setActionError(null);
    rpc.call('run', { threadId, request, origin: 'user' }).catch(cause => setActionError(message(cause)));
  }, [rpc, threadId]);
  const cancelOp = useCallback(() => { rpc.call('cancel', { threadId }).catch(cause => setActionError(message(cause))); }, [rpc, threadId]);


  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    // Keep BB's global shortcuts from acting on keys meant for the pop-up.
    if (event.key !== 'Escape') event.stopPropagation();
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
    else if (repo && (event.key === 'P' || event.key === 'p' || event.key === 'f')) {
      const op = event.key === 'P' ? 'push' : event.key === 'p' ? 'pull' : 'fetch';
      event.preventDefault();
      if (available(repo, state.op)[op].enabled) runOp({ kind: op });
    }
  }

  const repo = state.snapshot?.kind === 'none' ? null : state.snapshot;
  return <dialog ref={dialog} className="gg-dialog" aria-label="Git status" onKeyDown={keyboard} data-instant={instant || undefined}
    data-zoomed={zoomed || undefined} data-morph={morph || undefined}
    style={{ top: position.top, left: position.left, width: position.width, transformOrigin: position.origin }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="gg-panel">
      {repo ? <Zoomed.Provider value={zoomed}><RepoView repo={repo} threadId={threadId} state={state} actionError={actionError}
        dismissed={dismissed} onDismiss={setDismissed} onRun={runOp} onCancel={cancelOp}
        picker={picker} onPicker={setPicker} onZoom={() => zoom('pointer')} onClose={onClose} /></Zoomed.Provider>
        : <div className="gg-blank">
          {state.error ? <><Icon name="AlertTriangle" className="gg-blank-icon gg-danger" /><strong>Could not read git status</strong><span>{state.error}</span></>
            : state.snapshot?.kind === 'none' ? <><Icon name="FolderUnknown" className="gg-blank-icon" /><strong>Not a git repository</strong><span>This thread's checkout has no repository.</span></>
            : <><span className="gg-spinner" /><span>Reading repository…</span></>}
        </div>}
    </div>
  </dialog>;
}
