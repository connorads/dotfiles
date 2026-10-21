import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixtureGit, tempDir } from './test-git.ts';
import { resolveRepo } from './repo.ts';
import { review } from './index-edit.ts';
import { generateMessage } from './message-draft.ts';

async function setup() {
  const cwd = tempDir();
  fixtureGit(cwd, 'init');
  writeFileSync(join(cwd, 'staged.txt'), 'staged content\n');
  fixtureGit(cwd, 'add', 'staged.txt');
  writeFileSync(join(cwd, 'staged.txt'), 'UNSTAGED SECRET\n');
  writeFileSync(join(cwd, 'untracked.txt'), 'UNTRACKED SECRET\n');
  const repo = await resolveRepo(cwd);
  assert.ok(repo);
  return { cwd, repo, expected: await review(repo) };
}
const signal = new AbortController().signal;

test('generation sends only staged content and leaves HEAD, index and working files unchanged', async () => {
  const { repo, expected, cwd } = await setup();
  const result = await generateMessage(repo, expected, { signal, model: 'gpt-6-luna', executable: 'codex' }, async prompt => {
    assert.match(prompt, /staged content/);
    assert.doesNotMatch(prompt, /UNSTAGED SECRET|UNTRACKED SECRET/);
    return 'Add staged text';
  });
  assert.equal(result.message, 'Add staged text');
  assert.deepEqual(await review(repo), expected);
  assert.match(fixtureGit(cwd, 'diff'), /UNSTAGED SECRET/);
});

test('stale review refuses before invoking the model', async () => {
  const { repo, expected, cwd } = await setup();
  fixtureGit(cwd, 'add', 'staged.txt');
  await assert.rejects(generateMessage(repo, expected, { signal, model: 'm', executable: 'codex' }, async () => {
    assert.fail('must not invoke model');
  }), /changed/);
});

test('index or HEAD changes during generation discard the response', async () => {
  for (const change of ['index', 'head']) {
    const { repo, expected, cwd } = await setup();
    await assert.rejects(generateMessage(repo, expected, { signal, model: 'm', executable: 'codex' }, async () => {
      if (change === 'index') fixtureGit(cwd, 'add', 'staged.txt');
      else fixtureGit(cwd, 'commit', '-m', 'External commit');
      return 'Outdated';
    }), /changed/);
  }
});

test('oversized staged input refuses without sending a partial diff', async () => {
  const { repo, cwd } = await setup();
  writeFileSync(join(cwd, 'big.txt'), 'x'.repeat(100_000));
  fixtureGit(cwd, 'add', 'big.txt');
  await assert.rejects(generateMessage(repo, await review(repo), { signal, model: 'm', executable: 'codex' }, async () => {
    assert.fail('must not send oversized diff');
  }), /large|buffer/i);
});

import { readFileSync } from 'node:fs';
import { completeMessage, codexArgs } from './message-draft.ts';

function executable(body: string) {
  const dir = tempDir();
  const path = join(dir, 'fake-codex');
  writeFileSync(path, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return path;
}
const events = (text: string) => [
  { type: 'item.completed', item: { type: 'agent_message', text } },
  { type: 'turn.completed' },
].map(event => JSON.stringify(event)).join('\n');

test('process adapter uses argv and stdin, isolated cwd, bounded JSON and no inherited agent config', async () => {
  const record = join(tempDir(), 'record.json');
  const fake = executable(`const fs = require('node:fs');
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd(), env: process.env }));
  process.stdout.write(${JSON.stringify(events('Fix greeting'))});
});`);
  const model = 'model with spaces; $(never-run)';
  const message = await completeMessage('Synthetic diff\n$(not-a-command)', { signal, model, executable: fake });
  assert.equal(message, 'Fix greeting');
  const captured = JSON.parse(readFileSync(record, 'utf8'));
  assert.deepEqual(captured.args, codexArgs(model));
  assert.equal(captured.args[captured.args.indexOf('--model') + 1], model);
  assert.equal(captured.input, 'Synthetic diff\n$(not-a-command)');
  assert.match(captured.cwd, /^\/private\/tmp\/git-glance-message-|^\/tmp\/git-glance-message-/);
  assert.equal(captured.env.BB_THREAD_ID, undefined);
  assert.ok(captured.args.includes('--ignore-user-config'));
  assert.ok(captured.args.includes('features.hooks=false'));
});

test('process failures, empty responses, malformed JSON and tool activity do not become drafts', async () => {
  for (const body of [
    'process.exit(2)',
    `process.stdout.write('not json')`,
    `process.stdout.write(${JSON.stringify(events(''))})`,
    `process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }) + '\n' + events('Unexpected'))})`,
    `process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial' } }))})`,
    `process.stdout.write('x'.repeat(300000)); setInterval(() => {}, 1000)`,
  ]) {
    await assert.rejects(completeMessage('diff', { signal, model: 'm', executable: executable(body) }), /Codex/);
  }
  await assert.rejects(completeMessage('diff', { signal, model: 'm', executable: '/nonexistent/git-glance-codex' }), /Cannot start/);
});

test('cancellation kills a running process and rejects without a draft', async () => {
  const controller = new AbortController();
  const pending = completeMessage('diff', { signal: controller.signal, model: 'm', executable: executable('setInterval(() => {}, 1000)') });
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, /cancelled/); } finally { clearTimeout(timer); }
});

test('deadline terminates a stalled completion', async context => {
  const ready = join(tempDir(), 'ready');
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = completeMessage('diff', { signal, model: 'm', executable: executable(`
require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready');
setInterval(() => {}, 1000);`) });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { readFileSync(ready); break; } catch { await new Promise(resolve => setImmediate(resolve)); }
  }
  assert.equal(readFileSync(ready, 'utf8'), 'ready');
  const rejection = assert.rejects(pending, /timed out/);
  context.mock.timers.tick(60_001);
  context.mock.timers.tick(500);
  await rejection;
});

test('UTF-8 output split between process chunks remains intact', async () => {
  const data = Buffer.from(events('Fix café greeting'));
  const split = data.indexOf(Buffer.from('é')) + 1;
  const fake = executable(`
const data = Buffer.from(${JSON.stringify(data.toString('base64'))}, 'base64');
process.stdout.write(data.subarray(0, ${split}));
setTimeout(() => process.stdout.write(data.subarray(${split})), 30);`);
  assert.equal(await completeMessage('diff', { signal, model: 'm', executable: fake }), 'Fix café greeting');
});

test('cancellation kills descendants that ignore SIGTERM after the CLI exits', async () => {
  const ready = join(tempDir(), 'child-pid');
  const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const fake = executable(`require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`);
  const controller = new AbortController();
  const pending = completeMessage('diff', { signal: controller.signal, model: 'm', executable: fake });
  const rejection = assert.rejects(pending, /cancelled/);
  let pid: number | undefined;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { pid = Number(readFileSync(ready, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    assert.ok(pid);
    controller.abort();
    await rejection;
    const childPid = pid;
    let alive = true;
    const stoppedBy = Date.now() + 1000;
    while (alive && Date.now() < stoppedBy) {
      try { process.kill(childPid, 0); await new Promise(resolve => setTimeout(resolve, 10)); }
      catch { alive = false; }
    }
    assert.equal(alive, false, `Descendant ${childPid} must stop`);
  } finally {
    controller.abort();
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
});
