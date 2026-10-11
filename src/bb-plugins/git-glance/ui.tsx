import { createContext, useEffect, useState } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { Change } from './contracts.ts';
import { diffBlocks } from './src/format.ts';

export const codeNames: Record<Change['code'], string> = {
  A: 'Added', C: 'Copied', D: 'Deleted', M: 'Modified', R: 'Renamed', T: 'Type changed', U: 'Conflicted', '?': 'Untracked',
};
export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export const changeKey = (change: Change) => `${change.area}:${change.path}`;
/** Zoomed views have room for side-by-side diffs. */
export const Zoomed = createContext(false);

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}
export function Fact({ tone, icon, title, children }: { tone: string; icon: string; title: string; children: React.ReactNode }) {
  return <span className="gg-fact" data-tone={tone} title={title}><Icon name={icon} className="size-3" />{children}</span>;
}

export function DiffBar({ added, removed }: { added: number | null; removed: number | null }) {
  return <span className="gg-blocks" aria-hidden>
    {diffBlocks(added ?? 0, removed ?? 0).map((block, index) => <i key={index} data-block={block} />)}
  </span>;
}
/** Copy and Check stacked, cross-faded, so the swap has both an exit and an entry. */
export function CopyIcon({ done }: { done: boolean }) {
  return <span className="gg-swap" data-done={done || undefined} aria-hidden>
    <Icon name="Copy" className="size-3" /><Icon name="Check" className="size-3" />
  </span>;
}
