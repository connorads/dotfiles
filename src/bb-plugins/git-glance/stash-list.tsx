import { useState } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { OpRequest, OpState, Repo } from './contracts.ts';
import { CommitPanel } from './commits.tsx';
import { age } from './src/format.ts';
import { HoldButton } from './ui.tsx';

type Stash = Repo['stashes'][number];
/** "On main: wip" and "WIP on main: abc123 subject" read better as the message alone. */
const label = (subject: string) => subject.replace(/^(?:On [^:]+|WIP on [^:]+): (?:[0-9a-f]{7,} )?/, '') || subject;

export function StashList({ stashes, threadId, now, op, copied, onCopy, onRun, selected, onSelect }: {
  stashes: Stash[]; threadId: string; now: number; op: OpState | null; copied: string | null;
  onCopy: (sha: string) => void; onRun: (request: OpRequest) => void;
  /** With `onSelect`, a stash opens in the detail pane rather than under its row. */
  selected?: string | null; onSelect?: (sha: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const busy = op?.status === 'running';
  return <ul className="gg-stash-list">{stashes.map(stash => {
    const expanded = onSelect ? selected === stash.sha : open === stash.sha;
    const run = (kind: 'stash-apply' | 'stash-pop' | 'stash-drop') => onRun({ kind, sha: stash.sha });
    return <li key={stash.sha} className="gg-stash" data-open={expanded || undefined}>
      <div className="gg-stash-row">
        <button type="button" data-row className="gg-stash-main" aria-expanded={expanded}
          onClick={() => onSelect ? onSelect(stash.sha) : setOpen(expanded ? null : stash.sha)} title={stash.subject}
          onFocus={onSelect ? () => onSelect(stash.sha) : undefined}
          onKeyDown={event => {
            // a applies and g pops (lazygit's pop key); Space stays "open", as on every other row.
            if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key === 'a') { event.preventDefault(); event.stopPropagation(); run('stash-apply'); }
            else if (event.key === 'g') { event.preventDefault(); event.stopPropagation(); run('stash-pop'); }
          }}>
          <Icon name="Archive" className="gg-stash-icon" />
          <span className="gg-subject">{label(stash.subject)}</span>
          <span className="gg-stash-ref">stash@{`{${stash.index}}`}</span>
          <span className="gg-age">{age(stash.time, now)}</span>
        </button>
        <span className="gg-stash-actions">
          <button type="button" className="gg-ghost" disabled={busy} onClick={() => run('stash-apply')} title="Apply, keeping the stash (a)">
            <Icon name="ArchiveRestore" className="size-3.5" />Apply
          </button>
          <button type="button" className="gg-ghost" disabled={busy} onClick={() => run('stash-pop')} title="Apply and drop the stash (g)">
            <Icon name="Check" className="size-3.5" />Pop
          </button>
          <HoldButton icon="Trash2" label="Drop" confirmLabel="Press again to drop" disabled={busy} onConfirm={() => run('stash-drop')} />
        </span>
      </div>
      {expanded && !onSelect && <CommitPanel sha={stash.sha} threadId={threadId} now={now} copied={copied} onCopy={onCopy} lanes={[]} width={0} stash />}
    </li>;
  })}</ul>;
}
