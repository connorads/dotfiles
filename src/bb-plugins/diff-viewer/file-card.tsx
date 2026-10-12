import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { experimental_Diff as Diff, experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { DiffViewMode } from '@get-bb/plugin-sdk/app';
import type { Body, FileDiff } from './contracts.ts';
import { splitPath, statusLetter } from './src/view.ts';

/** A whole-file fetch: in flight, done, or failed. */
export type Fetched = 'loading' | Body | { error: string };

interface Props {
  file: FileDiff;
  collapsed: boolean;
  view: DiffViewMode;
  fetched: Fetched | undefined;
  /** The reader asked for this file's whole patch. */
  wantFull: boolean;
  onToggle: (path: string) => void;
  onFetch: (file: FileDiff) => void;
  onWantFull: (path: string) => void;
}

export function Counts({ additions, deletions }: { additions: number | null; deletions: number | null }) {
  if (additions === null || deletions === null) return null;
  return <span className="dv-counts">
    {additions > 0 && <span className="dv-add">+{additions}</span>}
    {deletions > 0 && <span className="dv-del">−{deletions}</span>}
  </span>;
}

export function FilePath({ path }: { path: string }) {
  const { dir, name } = splitPath(path);
  return <span className="dv-path" title={path}><span className="dv-dir">{dir}</span>{name}</span>;
}

const deferredText = {
  lockfile: 'Lockfile.',
  large: 'Large diff.',
  budget: 'Not loaded yet.',
};

function Notice({ children }: { children: ReactNode }) {
  return <div className="dv-notice">{children}</div>;
}

/**
 * One file: a sticky header and its diff. Lockfiles and files past the first
 * load's budget fetch when expanded and near the viewport; a large file waits
 * for a click.
 */
export const FileCard = memo(function FileCard({ file, collapsed, view, fetched, wantFull, onToggle, onFetch, onWantFull }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => setNear(entries.some(entry => entry.isIntersecting)), { rootMargin: '800px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const automatic = file.body.kind === 'deferred' && file.body.reason !== 'large';
  useEffect(() => {
    if (!collapsed && near && fetched === undefined && (wantFull || automatic)) onFetch(file);
  }, [collapsed, near, fetched, wantFull, automatic, file, onFetch]);

  const body: Body | 'loading' | { error: string } = fetched ?? file.body;
  const renamed = file.oldPath !== null;

  return <section ref={ref} className="dv-file" data-path={file.path} data-collapsed={collapsed || undefined}>
    <header className="dv-file-header">
      <button type="button" className="dv-file-toggle" aria-expanded={!collapsed} onClick={() => onToggle(file.path)}
        title={collapsed ? 'Expand (x)' : 'Collapse (x)'}>
        <Icon name={collapsed ? 'ChevronRight' : 'ChevronDown'} className="dv-chevron" />
        <span className="dv-status" data-status={file.status} title={file.status}>{statusLetter[file.status]}</span>
        {renamed && <><FilePath path={file.oldPath!} /><span className="dv-arrow">→</span></>}
        <FilePath path={file.path} />
        {file.untracked && <span className="dv-tag">untracked</span>}
        {file.lockfile && <span className="dv-tag">lockfile</span>}
        <Counts additions={file.additions} deletions={file.deletions} />
      </button>
    </header>
    {!collapsed && <div className="dv-file-body">
      {body === 'loading' ? <Notice>Loading diff…</Notice>
        : 'error' in body ? <Notice><span className="dv-error">{body.error}</span>
          <button type="button" className="dv-link" onClick={() => onFetch(file)}>Retry</button></Notice>
        : body.kind === 'patch' ? <>
          <Diff patch={body.patch} path={file.path} view={view} overflow="scroll" className="dv-diff" />
          {body.shownLines < body.totalLines && <Notice>
            Showing {body.shownLines.toLocaleString()} of {body.totalLines.toLocaleString()} lines.
            {fetched === undefined && <button type="button" className="dv-link" onClick={() => onWantFull(file.path)}>Show all</button>}
          </Notice>}
        </>
        : body.kind === 'binary' ? <Notice>Binary file.</Notice>
        : body.kind === 'empty' ? <Notice>{file.modeChange ? `Mode ${file.modeChange}.`
          : file.status === 'renamed' ? 'Renamed without changes.' : file.status === 'copied' ? 'Copied without changes.' : 'No line changes.'}</Notice>
        : <Notice>
          {deferredText[body.reason]}
          {file.additions !== null && file.deletions !== null && ` ${(file.additions + file.deletions).toLocaleString()} changed lines.`}
          {body.reason === 'large' && <button type="button" className="dv-link" onClick={() => onWantFull(file.path)}>Load diff</button>}
        </Notice>}
    </div>}
  </section>;
});
