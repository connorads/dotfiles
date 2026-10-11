import { useContext, useEffect, useState } from 'react';
import { experimental_Diff as Diff, experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { Change, DiffSource, rpcContract } from './contracts.ts';
import { splitPath } from './src/format.ts';
import { codeNames, DiffBar, message, Zoomed } from './ui.tsx';

/** A changed file, from the working tree or from one commit. */
export type FileRow = Pick<Change, 'path' | 'origPath' | 'code' | 'added' | 'removed'>;

export function ChangeRow({ file, source, threadId, open, onToggle, flash = null }: {
  file: FileRow; source: DiffSource; threadId: string; open: boolean; onToggle: () => void;
  /** Set when the row is new or changed in this update; a new value replays the highlight. */
  flash?: string | null;
}) {
  const { dir, name } = splitPath(file.path);
  const directory = file.path.endsWith('/');
  const counted = file.added !== null && file.removed !== null;
  const note = directory ? 'folder' : file.code === '?' ? 'new' : file.code === 'U' ? '' : 'binary';
  return <li className="gg-change" data-open={open || undefined}>
    {flash && <span className="gg-flash" key={flash} aria-hidden />}
    <button type="button" data-row className="gg-change-row" aria-expanded={directory ? undefined : open}
      disabled={directory} onClick={onToggle} title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
      <span className="gg-code" data-code={file.code} title={codeNames[file.code]}>{file.code === '?' ? 'U' : file.code === 'U' ? '!' : file.code}</span>
      <span className="gg-path">
        <span className="gg-name">{name}</span>
        {(dir || file.origPath) && <span className="gg-dir"><bdi>{file.origPath ? `from ${file.origPath}` : dir}</bdi></span>}
      </span>
      {counted
        ? <span className="gg-stat"><span className="gg-add">+{file.added}</span><span className="gg-del">−{file.removed}</span></span>
        : <span className="gg-stat gg-muted">{note}</span>}
      {counted ? <DiffBar added={file.added} removed={file.removed} /> : <span />}
      {!directory && <Icon name="ChevronDown" className="gg-row-chevron" />}
    </button>
    {open && <DiffPane file={file} source={source} threadId={threadId} />}
  </li>;
}

export function DiffPane({ file, source, threadId }: { file: FileRow; source: DiffSource; threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const zoomed = useContext(Zoomed);
  const [result, setResult] = useState<{ patch: string; truncated: boolean } | { error: string } | null>(null);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    let live = true;
    rpc.call('diff', { threadId, path: file.path, origPath: file.origPath, source: JSON.parse(sourceKey) as DiffSource })
      .then(value => { if (live) setResult(value); }, cause => { if (live) setResult({ error: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId, file.path, file.origPath, file.added, file.removed, sourceKey]);
  if (!result) return <div className="gg-diff gg-diff-loading" aria-busy><i /><i /><i /></div>;
  if ('error' in result) return <div className="gg-diff gg-note gg-danger">{result.error}</div>;
  if (!result.patch.trim()) return <div className="gg-diff gg-note">No textual changes.</div>;
  return <div className="gg-diff">
    <Diff patch={result.patch} path={file.path} view={zoomed ? 'split' : 'unified'} overflow="scroll" className="gg-diff-view" />
    {result.truncated && <p className="gg-note">Diff truncated. Open lazygit for the rest.</p>}
  </div>;
}
