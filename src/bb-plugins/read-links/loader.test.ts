import { expect, it, vi } from 'vitest';
import { loadTargets, type TimelinePage } from './loader';

const read = (id: string): TimelinePage['rows'][number] => ({ id, kind: 'work', workKind: 'file-read', path: `/${id}` });
const pages: TimelinePage[] = [
  { rows: [read('t:file-read:3')], olderCursor: { anchorId: 'a', anchorSeq: 2 } },
  { rows: [read('t:file-read:2')], olderCursor: { anchorId: 'b', anchorSeq: 1 } },
  { rows: [read('t:file-read:1')], olderCursor: null },
];

it('stops paging once every wanted row is found', async () => {
  const fetchPage = vi.fn(async (_cursor: unknown, _signal: AbortSignal) => pages[fetchPage.mock.calls.length - 1]);
  const found = await loadTargets(fetchPage, new Set(['t:file-read:2']), null, new AbortController().signal);
  expect(fetchPage).toHaveBeenCalledTimes(2);
  expect(fetchPage.mock.calls[1][0]).toEqual({ anchorId: 'a', anchorSeq: 2 });
  expect(found.get('t:file-read:2')).toEqual(['/t:file-read:2']);
});

it('stops at the start of history when a wanted row never appears', async () => {
  const fetchPage = vi.fn(async (_cursor: unknown, _signal: AbortSignal) => pages[fetchPage.mock.calls.length - 1]);
  const found = await loadTargets(fetchPage, new Set(['t:file-read:9']), null, new AbortController().signal);
  expect(fetchPage).toHaveBeenCalledTimes(3);
  expect(found.has('t:file-read:9')).toBe(false);
});
