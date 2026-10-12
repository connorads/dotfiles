import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePatch, unquotePath } from './patch.ts';

const modified = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 keep
-old
+new
+++ looks like a header but is content
@@ -10,2 +10,1 @@ ctx
--- also content
 tail
`;

test('a modified file: counts only hunk lines, even ones that look like headers', () => {
  const [file] = parsePatch(modified);
  assert.deepEqual({ ...file, patch: undefined }, {
    path: 'src/a.ts', oldPath: null, status: 'modified', binary: false, modeChange: null,
    additions: 2, deletions: 2, hunks: 2, patch: undefined,
  });
  assert.equal(file!.patch, modified);
});

test('several files split at each diff --git line', () => {
  const added = 'diff --git a/new.md b/new.md\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/new.md\n@@ -0,0 +1 @@\n+hi\n';
  const deleted = 'diff --git a/gone.md b/gone.md\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/gone.md\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n';
  const files = parsePatch(modified + added + deleted);
  assert.deepEqual(files.map(f => [f.path, f.status, f.additions, f.deletions]),
    [['src/a.ts', 'modified', 2, 2], ['new.md', 'added', 1, 0], ['gone.md', 'deleted', 0, 2]]);
  assert.equal(files[2]!.patch, deleted);
});

test('a rename with edits, a pure rename and a copy', () => {
  const files = parsePatch([
    'diff --git a/old name.ts b/new name.ts\nsimilarity index 90%\nrename from old name.ts\nrename to new name.ts\nindex 1..2 100644\n--- a/old name.ts\n+++ b/new name.ts\n@@ -1 +1 @@\n-a\n+b\n',
    'diff --git a/x/a b/y/a\nsimilarity index 100%\nrename from x/a\nrename to y/a\n',
    'diff --git a/a.txt b/c.txt\nsimilarity index 100%\ncopy from a.txt\ncopy to c.txt\n',
  ].join(''));
  assert.deepEqual(files.map(f => [f.path, f.oldPath, f.status, f.hunks]),
    [['new name.ts', 'old name.ts', 'renamed', 1], ['y/a', 'x/a', 'renamed', 0], ['c.txt', 'a.txt', 'copied', 0]]);
});

test('binary and mode-only changes take their paths from the header, spaces included', () => {
  const files = parsePatch([
    'diff --git a/img dir/logo b.png b/img dir/logo b.png\nindex 1..2 100644\nBinary files a/img dir/logo b.png and b/img dir/logo b.png differ\n',
    'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n',
    'diff --git a/blob.bin b/blob.bin\nnew file mode 100644\nindex 0..1\nGIT binary patch\nliteral 3\nKcmZ?\n\n',
  ].join(''));
  assert.deepEqual(files.map(f => [f.path, f.status, f.binary, f.modeChange]), [
    ['img dir/logo b.png', 'modified', true, null],
    ['run.sh', 'modified', false, '100644 → 100755'],
    ['blob.bin', 'added', true, null],
  ]);
});

test('quoted paths: control characters, quotes and octal UTF-8', () => {
  assert.equal(unquotePath('"tab\\there"'), 'tab\there');
  assert.equal(unquotePath('"r\\303\\251sum\\303\\251"'), 'résumé');
  assert.equal(unquotePath('"say \\"hi\\" 🙂"'), 'say "hi" 🙂');
  assert.equal(unquotePath('plain'), 'plain');
  const [file] = parsePatch('diff --git "a/r\\303\\251sum\\303\\251\\n" "b/r\\303\\251sum\\303\\251\\n"\nindex 1..2 100644\nBinary files "a/r\\303\\251sum\\303\\251\\n" and "b/r\\303\\251sum\\303\\251\\n" differ\n');
  assert.equal(file!.path, 'résumé\n');
  const [edited] = parsePatch('diff --git "a/q\\"x" "b/q\\"x"\n--- "a/q\\"x"\n+++ "b/q\\"x"\n@@ -1 +1 @@\n-a\n+b\n');
  assert.equal(edited!.path, 'q"x');
});

test('no diff yields no files', () => {
  assert.deepEqual(parsePatch(''), []);
});
