import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from './process.ts';

test('runs argv without shell evaluation and strips repository redirects', async () => {
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = '/tmp/synthetic-redirect';
  try {
    const result = await run(process.execPath, ['-e', 'console.log(JSON.stringify({arg:process.argv[1],gitDir:process.env.GIT_DIR,prompt:process.env.GIT_TERMINAL_PROMPT}))', '$(touch should-not-exist)']);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { arg: '$(touch should-not-exist)', prompt: '0' });
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
  }
});

test('bounds output and reports missing binaries and cancellation', async () => {
  const output = await run(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxBytes: 1000 });
  assert.notEqual(output.code, 0);
  assert.ok(output.stdout.length <= 1000);
  assert.match(output.stderr, /output limit/i);
  assert.equal((await run('/nonexistent/synthetic-command', [])).code, 127);
  const controller = new AbortController();
  controller.abort();
  assert.notEqual((await run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal })).code, 0);
});
