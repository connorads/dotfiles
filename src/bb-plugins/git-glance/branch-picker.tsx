import { useEffect, useMemo, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { Branch, OpRequest, rpcContract } from './contracts.ts';
import { age } from './src/format.ts';
import { message } from './ui.tsx';

/** Filter as you type, arrows to move, enter to switch; local branches first. */
export function BranchPicker({ threadId, instant, onSwitch, onClose }: {
  threadId: string; instant: boolean; onSwitch: (request: OpRequest) => void; onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [branches, setBranches] = useState<Branch[] | { error: string } | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const now = Date.now();
  useEffect(() => {
    let live = true;
    rpc.call('branches', { threadId }).then(value => { if (live) setBranches(value); }, cause => { if (live) setBranches({ error: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId]);
  const shown = useMemo(() => {
    if (!Array.isArray(branches)) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return branches.filter(branch => words.every(word => branch.name.toLowerCase().includes(word)));
  }, [branches, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function choose(branch: Branch | undefined) {
    if (!branch || branch.current) return;
    onSwitch({ kind: 'switch', branch: branch.name, track: branch.kind === 'remote' });
    onClose();
  }
  function keyboard(event: React.KeyboardEvent) {
    // The pop-up's own keys (q, p, f…) must not fire while typing a branch name.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(shown.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(shown[active]); }
  }
  const firstRemote = shown.findIndex(branch => branch.kind === 'remote');
  return <div className="gg-picker" data-instant={instant || undefined} role="dialog" aria-label="Switch branch" onKeyDown={keyboard}>
    <div className="gg-picker-search">
      <Icon name="Search" className="size-3.5" />
      <input autoFocus aria-label="Filter branches" placeholder="Switch to branch…" value={query} onChange={event => setQuery(event.target.value)} />
      <kbd>esc</kbd>
    </div>
    {branches === null ? <div className="gg-diff-loading" aria-busy><i /><i /><i /></div>
      : !Array.isArray(branches) ? <p className="gg-note gg-danger">{branches.error}</p>
      : shown.length === 0 ? <p className="gg-note">No branch matches “{query}”.</p>
      : <ul ref={list} className="gg-picker-list" role="listbox" aria-label="Branches">
        {shown.map((branch, index) => <li key={`${branch.kind}:${branch.name}`} role="presentation">
          {index === firstRemote && <div className="gg-picker-group">Remote</div>}
          <button type="button" role="option" aria-selected={index === active} data-active={index === active || undefined}
            disabled={branch.current} onMouseEnter={() => setActive(index)} onClick={() => choose(branch)}
            title={branch.current ? 'Current branch' : branch.kind === 'remote' ? `Create ${branch.name.slice(branch.name.indexOf('/') + 1)} tracking ${branch.name}` : `Switch to ${branch.name}`}>
            <Icon name={branch.current ? 'Check' : branch.kind === 'remote' ? 'Cloud' : 'GitBranch'} className="size-3.5" />
            <span className="gg-picker-name">{branch.name}</span>
            {branch.ahead > 0 && <span className="gg-chip-ahead">↑{branch.ahead}</span>}
            {branch.behind > 0 && <span className="gg-chip-behind">↓{branch.behind}</span>}
            {branch.gone && <span className="gg-tag" title="Its upstream branch was deleted">gone</span>}
            <span className="gg-picker-subject">{branch.subject}</span>
            <span className="gg-age">{branch.time ? age(branch.time, now) : ''}</span>
          </button>
        </li>)}
      </ul>}
  </div>;
}
