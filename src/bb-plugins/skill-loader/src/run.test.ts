import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createRunner, defaultPathPrefix } from './run.ts';
import { createSkl } from './skl.ts';

const node = createRunner({ command: process.execPath, timeoutMs: 5_000 });

test('stdin, cwd and both streams reach and leave the child verbatim', async () => {
  const cwd = realpathSync(tmpdir());
  const script = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(process.cwd()+"|"+s);process.stderr.write("warn");process.exit(3)})';
  const result = await node(['-e', script], { cwd, stdin: 'a "quoted" $ref; `x`\n' });
  assert.deepEqual(result, { code: 3, stdout: `${cwd}|a "quoted" $ref; \`x\`\n`, stderr: 'warn' });
});

test('a missing binary is exit 127 with a readable reason', async () => {
  const run = createRunner({ command: 'skl-does-not-exist', timeoutMs: 1_000 });
  assert.deepEqual(await run(['list']), { code: 127, stdout: '', stderr: 'skl-does-not-exist not found on PATH' });
});

test('a hung child is stopped at the timeout', async () => {
  const run = createRunner({ command: process.execPath, timeoutMs: 200 });
  const result = await run(['-e', 'setTimeout(() => {}, 10_000)']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /stopped by SIGTERM/);
});

test('no variable that redirects git reaches skl, so a hook\'s repository cannot become the install target', async () => {
  const names = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(names.includes('GIT_INDEX_FILE'));
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = '/decoy';
  try {
    const run = createRunner({ command: process.execPath, timeoutMs: 5_000 });
    const script = `process.stdout.write(JSON.stringify(${JSON.stringify(names)}.filter(n => n in process.env)))`;
    assert.deepEqual(JSON.parse((await run(['-e', script])).stdout), []);
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

// Characterisation against the real catalogue, when this machine has skl.
const hasSkl = (() => {
  try {
    execFileSync('skl', ['--help'], { stdio: 'ignore', env: { ...process.env, PATH: `${defaultPathPrefix().join(':')}:${process.env.PATH}` } });
    return true;
  } catch {
    return false;
  }
})();

test('the real skl listing parses and a real pointer names its SKILL.md', { skip: !hasSkl && 'skl not installed' }, async () => {
  const skl = createSkl(createRunner({ command: 'skl', timeoutMs: 15_000, pathPrefix: defaultPathPrefix() }));
  const rows = await skl.list();
  const folder = rows.find(row => row.kind === 'folder');
  assert.ok(folder && folder.kind === 'folder');
  assert.equal(rows.filter(row => row.kind === 'skill' && row.source === folder.source).length, folder.count);
  const first = rows.find(row => row.kind === 'skill');
  assert.ok(first);
  assert.match(await skl.pointers([first.ref]), /^\S+ \(skl: .+\)[\s\S]*Read SKILL\.md at \/.+\/SKILL\.md and follow it\.$/);
});
