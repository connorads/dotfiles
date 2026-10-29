import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSkl, type Run } from './skl.ts';

/** A fake skl over an in-memory catalogue, recording every invocation. */
function fakeSkl(options: { installCode?: number } = {}) {
  const calls: { argv: readonly string[]; cwd?: string; stdin?: string }[] = [];
  const skills: Record<string, string> = { 'mine/tdd': 'tdd', 'mine/ts': 'ts', 'expo/router': 'router' };
  const run: Run = async (argv, { cwd, stdin } = {}) => {
    calls.push({ argv, cwd, stdin });
    const [verb, ref] = argv;
    if (verb === 'list') return { code: 0, stdout: 'mine/  (2)\nmine/tdd  T\nmine/ts\nexpo/  (1)\nexpo/router\n', stderr: '' };
    if (verb === 'preview' && ref && skills[ref]) return { code: 0, stdout: `${skills[ref]}\n\n(skl: ${ref})\n`, stderr: '' };
    if (verb === 'preview') return { code: 1, stdout: '', stderr: `skl: no skill named "${ref}"\n` };
    if (verb === 'load') {
      const refs = (stdin ?? '').split('\n').filter(Boolean).flatMap(r => r.endsWith('/') ? Object.keys(skills).filter(k => k.startsWith(r)) : [r]);
      const gone = refs.find(r => !skills[r]);
      if (gone) return { code: 1, stdout: '', stderr: `skl: no skill named "${gone}"\n` };
      return { code: 0, stdout: `${refs.map(r => `${skills[r]} (skl: ${r})`).join('\n\n')}\n`, stderr: '' };
    }
    if (verb === 'install') return { code: options.installCode ?? 0, stdout: 'skl: installed mine/tdd → /repo\n', stderr: options.installCode ? 'skl: not inside a git work-tree\n' : '' };
    return { code: 2, stdout: '', stderr: 'usage' };
  };
  return { skl: createSkl(run), calls };
}

test('list reads the folder listing', async () => {
  const { skl, calls } = fakeSkl();
  assert.deepEqual((await skl.list()).map(row => row.ref), ['mine/', 'mine/tdd', 'mine/ts', 'expo/', 'expo/router']);
  assert.deepEqual(calls[0]?.argv, ['list', '--folders']);
});

test('pointers run one recorded skl load --stdin --print per send', async () => {
  const { skl, calls } = fakeSkl();
  assert.equal(await skl.pointers(['expo/', 'mine/']), 'router (skl: expo/router)\n\ntdd (skl: mine/tdd)\n\nts (skl: mine/ts)');
  assert.deepEqual(calls, [{ argv: ['load', '--stdin', '--print'], cwd: undefined, stdin: 'expo/\nmine/\n' }]);
});

test('one unknown ref fails the whole batch with skl\'s error', async () => {
  const { skl } = fakeSkl();
  await assert.rejects(skl.pointers(['mine/tdd', 'mine/gone']), /no skill named "mine\/gone"/);
});

test('a failing skl surfaces its stderr', async () => {
  const { skl } = fakeSkl();
  await assert.rejects(skl.preview('mine/gone'), /no skill named "mine\/gone"/);
});

test('install pipes refs on stdin from the project cwd', async () => {
  const { skl, calls } = fakeSkl();
  assert.deepEqual(await skl.install(['mine/tdd', 'expo/'], '/repo'), { ok: true, output: 'skl: installed mine/tdd → /repo' });
  assert.deepEqual(calls[0], { argv: ['install', '--stdin'], cwd: '/repo', stdin: 'mine/tdd\nexpo/\n' });
});

test('a refused install is a value carrying both streams', async () => {
  const { skl } = fakeSkl({ installCode: 1 });
  const outcome = await skl.install(['mine/tdd'], '/home');
  assert.equal(outcome.ok, false);
  assert.match(outcome.output, /not inside a git work-tree/);
});
