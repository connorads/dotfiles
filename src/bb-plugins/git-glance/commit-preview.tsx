import { useState } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { experimental_copyToClipboard, experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import type { CommitLink } from './chat-links.ts';
import { CommitPanel } from './commits.tsx';
import { chip } from './popover.tsx';
import { useRepo } from './repo-store.ts';
import { useNow } from './ui.tsx';

/** Chat opens a commit directly, including commits outside the recent history list. */
export function CommitPreview({ threadId, sha, onClose, onRepository }: CommitLink & { onClose: () => void; onRepository: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const state = useRepo(threadId, rpc);
  const now = useNow(1000);
  const [copied, setCopied] = useState<string | null>(null);
  const repo = state.snapshot?.kind === 'none' ? null : state.snapshot;
  return <ChipPopover className="gg-dialog" panelClassName="gg-panel" aria-label={`Commit ${sha}`} anchor={null}
    trigger={() => chip(threadId)} width={760} instant onClose={onClose}
    onKeyDown={event => { if (event.key === 'q' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) onClose(); }}>
    <header className="gg-header">
      <div className="gg-eyebrow">
        <Icon name="GitBranch" className="size-3.5" />
        <span>{repo?.name ?? 'Git Glance'} · {sha}</span>
        <span className="gg-spacer" />
        <button type="button" className="gg-ghost" onClick={onRepository}>Git status</button>
        <button type="button" className="gg-ghost gg-icon-button" aria-label="Close" onClick={onClose}><Icon name="X" className="size-3.5" /></button>
      </div>
      {state.root && <span className="gg-note">{state.root}</span>}
    </header>
    <div className="gg-body">
      {repo ? <CommitPanel key={`${state.root}:${sha}`} sha={sha} threadId={threadId} now={now} copied={copied} lanes={[]} width={0} preview
        onCopy={value => { void experimental_copyToClipboard({ text: value }).then(ok => { if (ok) setCopied(value); }); }} />
        : <p className="gg-note" role="status">{state.error ?? (state.snapshot ? 'No repository selected. Open Git status to choose one.' : 'Reading repository…')}</p>}
    </div>
  </ChipPopover>;
}
