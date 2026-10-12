import { useEffect, useMemo, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { Commit, CommitDetail, rpcContract } from './contracts.ts';
import { GraphCell, graphWidth, laneColour, laneX } from './graph.tsx';
import { ChangeRow } from './rows.tsx';
import { age, plural } from './src/format.ts';
import { layoutGraph } from './src/graph.ts';
import { CopyIcon, DiffBar, message } from './ui.tsx';

export function CommitList({ commits, threadId, now, copied, onCopy, fresh, stamp, selected, onSelect }: {
  commits: Commit[]; threadId: string; now: number; copied: string | null; onCopy: (sha: string) => void;
  fresh: Set<string>; stamp: string;
  /** With `onSelect`, a commit opens in the detail pane rather than under its row. */
  selected?: string | null; onSelect?: (sha: string) => void;
}) {
  const rows = useMemo(() => layoutGraph(commits), [commits]);
  const width = graphWidth(Math.max(...rows.map(row => row.width)));
  const [open, setOpen] = useState<string | null>(null);
  return <ol className="gg-commit-list">{commits.map((commit, index) => {
    const row = rows[index]!;
    const expanded = onSelect ? selected === commit.sha : open === commit.sha;
    return <li key={commit.sha} data-open={expanded || undefined}>
      {fresh.has(commit.sha) && <span className="gg-flash" key={stamp} aria-hidden />}
      <button type="button" data-row data-sha={commit.sha} className="gg-commit" data-unpushed={commit.unpushed || undefined}
        aria-expanded={expanded} onClick={() => onSelect ? onSelect(commit.sha) : setOpen(expanded ? null : commit.sha)}
        onFocus={onSelect ? () => onSelect(commit.sha) : undefined}
        title={`${commit.subject}\n${commit.author}${commit.unpushed ? ' · not pushed' : ''}`}>
        <GraphCell row={row} width={width} head={index === 0} unpushed={commit.unpushed} merge={commit.parents.length > 1} />
        <span className="gg-subject">{commit.subject}</span>
        {commit.refs.map(ref => <span key={`${ref.kind}:${ref.name}`} className="gg-ref" data-kind={ref.kind}
          style={ref.kind === 'head' ? { '--gg-ref': laneColour(row.lane) } as React.CSSProperties : undefined}>
          <Icon name={ref.kind === 'tag' ? 'Pin' : ref.kind === 'remote' ? 'Cloud' : 'GitBranch'} className="size-3" />{ref.name}
        </span>)}
        <span className="gg-meta">
          {copied === commit.sha ? <span className="gg-copied"><Icon name="Check" className="size-3" />Copied</span>
            : <><span className="gg-short">{commit.sha.slice(0, 7)}</span><span className="gg-age">{age(commit.time, now)}</span></>}
        </span>
        <Icon name="ChevronDown" className="gg-row-chevron" />
      </button>
      {expanded && !onSelect && <CommitPanel sha={commit.sha} threadId={threadId} now={now} copied={copied} onCopy={onCopy}
        lanes={[...new Set([...row.through, ...row.outgoing.map(segment => segment.to)])]} width={width} />}
    </li>;
  })}</ol>;
}

/** Lines for the lanes that continue past an expanded commit, so the graph stays joined. */
export function LaneRails({ lanes, width }: { lanes: number[]; width: number }) {
  return <svg className="gg-rails" width={width} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden>
    {lanes.map(lane => <line key={lane} x1={laneX(lane)} x2={laneX(lane)} y1={0} y2={100} stroke={laneColour(lane)} />)}
  </svg>;
}

export function CommitPanel({ sha, threadId, now, copied, onCopy, lanes, width, stash = false }: {
  sha: string; threadId: string; now: number; copied: string | null; onCopy: (sha: string) => void; lanes: number[]; width: number;
  /** A stash is a two-parent commit, but calling it a merge would mislead. */
  stash?: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [detail, setDetail] = useState<CommitDetail | { error: string } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call('commit', { threadId, sha }).then(value => { if (live) setDetail(value); }, cause => { if (live) setDetail({ error: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId, sha]);
  const totals = detail && !('error' in detail)
    ? detail.files.reduce((sum, f) => ({ added: sum.added + (f.added ?? 0), removed: sum.removed + (f.removed ?? 0) }), { added: 0, removed: 0 }) : null;
  const authored = detail && !('error' in detail) ? new Date(detail.authoredAt * 1000) : null;
  return <div className="gg-commit-panel" style={{ '--gg-graph': `${width}px` } as React.CSSProperties}>
    <LaneRails lanes={lanes} width={width} />
    <div className="gg-commit-body">
      {!detail ? <div className="gg-diff-loading" aria-busy><i /><i /><i /></div>
        : 'error' in detail ? <p className="gg-note gg-danger">{detail.error}</p>
        : <>
          {detail.body && <p className="gg-message">{detail.body}</p>}
          <div className="gg-commit-meta">
            <span className="gg-avatar" aria-hidden>{initials(detail.author)}</span>
            <span><strong>{detail.author}</strong> <span title={authored!.toLocaleString('en-GB')}>{age(detail.authoredAt, now)} ago</span>
              {detail.committer !== detail.author && <span className="gg-muted"> · committed by {detail.committer}</span>}</span>
            <span className="gg-spacer" />
            {detail.parents.length > 1 && !stash && <span className="gg-tag">merge</span>}
            <button type="button" className="gg-fact gg-sha" data-tone="quiet" onClick={() => onCopy(detail.sha)} title="Copy full sha">
              <CopyIcon done={copied === detail.sha} />{copied === detail.sha ? 'Copied' : detail.sha.slice(0, 10)}
            </button>
          </div>
          <div className="gg-summary gg-commit-summary">
            <span><strong>{plural(detail.files.length + detail.hidden, 'file')}</strong> changed</span>
            {totals && (totals.added > 0 || totals.removed > 0) && <span className="gg-stat"><span className="gg-add">+{totals.added}</span><span className="gg-del">−{totals.removed}</span></span>}
            {totals && <DiffBar added={totals.added} removed={totals.removed} />}
          </div>
          <ul className="gg-commit-files">{detail.files.map(f => <ChangeRow key={f.path} file={f} source={{ kind: 'commit', sha: detail.sha }}
            threadId={threadId} open={file === f.path} onToggle={() => setFile(current => current === f.path ? null : f.path)} />)}</ul>
          {detail.hidden > 0 && <p className="gg-note">{plural(detail.hidden, 'more file')} not shown.</p>}
        </>}
    </div>
  </div>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?';
