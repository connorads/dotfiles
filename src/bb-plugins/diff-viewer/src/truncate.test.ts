import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePatch } from './patch.ts';
import { truncatePatch } from './truncate.ts';

const header = 'diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n';
const hunk = (start: number, lines: string[]) => `@@ -${start},${lines.filter(l => !l.startsWith('+')).length} +${start},${lines.filter(l => !l.startsWith('-')).length} @@\n${lines.join('\n')}\n`;
const patch = header + hunk(1, [' a', '-b', '+c']) + hunk(20, [' d', '+e', '+f', ' g']);

test('a patch within limits is unchanged', () => {
  assert.deepEqual(truncatePatch(patch, { maxLines: 7, maxChars: 10_000 }), { patch, shownLines: 7, totalLines: 7 });
});

test('whole hunks are kept while they fit', () => {
  const cut = truncatePatch(patch, { maxLines: 5, maxChars: 10_000 });
  assert.deepEqual(cut, { patch: header + hunk(1, [' a', '-b', '+c']), shownLines: 3, totalLines: 7 });
});

test('an oversized first hunk is cut and its header recounted, so it still parses', () => {
  const big = header + hunk(1, [' a', '-b', '+c', '+d', ' e', '\\ No newline at end of file']);
  const cut = truncatePatch(big, { maxLines: 4, maxChars: 10_000 });
  assert.equal(cut.patch, `${header}@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n`);
  assert.deepEqual([cut.shownLines, cut.totalLines], [4, 6]);
  const [file] = parsePatch(cut.patch);
  assert.deepEqual([file!.additions, file!.deletions], [2, 1]);
});

test('the character limit cuts too, keeping at least one line', () => {
  const long = header + hunk(1, [`+${'x'.repeat(500)}`, `+${'y'.repeat(500)}`]);
  const cut = truncatePatch(long, { maxLines: 100, maxChars: 300 });
  assert.equal(cut.shownLines, 1);
  assert.match(cut.patch, /@@ -1,0 \+1,1 @@\n\+x{500}\n$/);
});

test('a patch without hunks passes through', () => {
  const binary = 'diff --git a/b b/b\nBinary files a/b and b/b differ\n';
  assert.deepEqual(truncatePatch(binary, { maxLines: 1, maxChars: 1 }), { patch: binary, shownLines: 0, totalLines: 0 });
});
