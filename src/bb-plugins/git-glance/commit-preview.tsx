import { useEffect, useRef, useState } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { experimental_copyToClipboard, experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { CommitLookup, rpcContract } from './contracts.ts';
import type { CommitLink } from './chat-links.ts';
import { CommitPanel } from './commits.tsx';
import { chip } from './popover.tsx';
import { renew, useRepo } from './repo-store.ts';
import { message, useNow } from './ui.tsx';

type Lookup = { kind: 'searching' | 'opening' } | { kind: 'error'; message: string }
  | { kind: 'choices'; hostId: string; result: CommitLookup }
  | { kind: 'ready'; root: string; sha: string };

/** Chat opens a commit directly, including commits outside the recent history list. */
export function CommitPreview({ threadId, sha, onClose, onRepository }: CommitLink & { onClose: () => void; onRepository: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const state = useRepo(threadId, rpc);
  const currentRoot = useRef(state.root);
  currentRoot.current = state.root;
  const now = useNow(1000);
  const [copied, setCopied] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ kind: 'searching' });
  const [choice, setChoice] = useState<{ hostId: string; root: string; sha: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLookup({ kind: 'searching' });
    void rpc.call('findCommit', { threadId, sha }).then(result => {
      if (!live) return;
      const match = result.matches[0];
      if (match && result.matches.length === 1 && result.unchecked === 0) {
        if (match.root === currentRoot.current) setLookup({ kind: 'ready', ...match });
        else setChoice({ hostId: result.hostId, ...match });
      }
      else setLookup({ kind: 'choices', hostId: result.hostId, result });
    }).catch(cause => { if (live) setLookup({ kind: 'error', message: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId, sha]);
  useEffect(() => {
    if (!choice) return;
    let live = true;
    setLookup({ kind: 'opening' });
    void rpc.call('openCheckout', { threadId, hostId: choice.hostId, path: choice.root }).then(async () => {
      await renew(threadId);
      if (live) setLookup({ kind: 'ready', root: choice.root, sha: choice.sha });
    }).catch(cause => { if (live) setLookup({ kind: 'error', message: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId, choice]);
  const repo = state.snapshot?.kind === 'none' ? null : state.snapshot;
  return <ChipPopover className="gg-dialog" panelClassName="gg-panel" aria-label={`Commit ${sha}`} anchor={null}
    trigger={() => chip(threadId)} width={760} instant onClose={onClose}
    onKeyDown={event => { if (event.key === 'q' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) onClose(); }}>
    <header className="gg-header">
      <div className="gg-eyebrow">
        <Icon name="GitBranch" className="size-3.5" />
        <span>{lookup.kind === 'ready' ? repo?.name ?? 'Git Glance' : 'Find commit'} · {sha}</span>
        <span className="gg-spacer" />
        <button type="button" className="gg-ghost" onClick={onRepository}>Git status</button>
        <button type="button" className="gg-ghost gg-icon-button" aria-label="Close" onClick={onClose}><Icon name="X" className="size-3.5" /></button>
      </div>
      {lookup.kind === 'ready' && <span className="gg-note">{lookup.root}</span>}
    </header>
    <div className="gg-body">
      {lookup.kind === 'ready' && state.root === lookup.root && repo ? <CommitPanel key={`${lookup.root}:${lookup.sha}`} sha={lookup.sha} threadId={threadId} now={now} copied={copied} lanes={[]} width={0} preview
        onCopy={value => { void experimental_copyToClipboard({ text: value }).then(ok => { if (ok) setCopied(value); }); }} />
        : lookup.kind === 'choices' ? <section className="gg-folder-picker">
          <p className="gg-note" role="status">{lookup.result.matches.length
            ? 'Choose a repository containing this commit.' : 'Commit not found in known repositories. Try a longer hash or choose a repository in Git status.'}</p>
          {lookup.result.unchecked > 0 && <p className="gg-note">Some repositories could not be checked. Results may be incomplete.</p>}
          <ul className="gg-commit-list">{lookup.result.matches.map(match => <li key={match.root}>
            <button type="button" className="gg-commit" title={match.root} onClick={() => setChoice({ hostId: lookup.hostId, ...match })}>
              <Icon name="GitBranch" className="size-3.5" /><span className="gg-subject">{match.root}</span>
              <span className="gg-short">{match.sha.slice(0, 10)}</span>
            </button>
          </li>)}</ul>
        </section>
        : <p className={`gg-note${lookup.kind === 'error' ? ' gg-danger' : ''}`} role={lookup.kind === 'error' ? 'alert' : 'status'}>
          {lookup.kind === 'error' ? lookup.message : lookup.kind === 'searching' ? 'Looking for commit…'
            : lookup.kind === 'opening' ? 'Opening repository…' : state.error ?? 'Repository selection changed. Reopen the commit.'}
        </p>}
    </div>
  </ChipPopover>;
}
