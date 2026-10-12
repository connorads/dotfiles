import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectUsage, profileEnvironment, providerEnv } from './claude.ts';

test('default profile removes inherited account overrides and keeps HOME', () => {
  const env = profileEnvironment(null);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.HOME, process.env.HOME);
  assert.equal(profileEnvironment('/named').CLAUDE_CONFIG_DIR, '/named');
});
test('default profile contributes no provider env so Claude keeps its native config directory', () => {
  assert.deepEqual(providerEnv(null), []);
  const named = providerEnv('/named');
  assert.equal(named.find(entry => entry.name === 'CLAUDE_CONFIG_DIR')?.value, '/named');
  assert.equal(named.find(entry => entry.name === 'ANTHROPIC_API_KEY')?.value, '');
});
test('quota subprocess sends only initialise and get_usage with skip_behaviors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-protocol-test-'));
  const cli = join(root, 'claude');
  const log = join(root, 'requests.jsonl');
  await writeFile(cli, `#!${process.execPath}\nimport { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
createInterface({ input: process.stdin }).on('line', line => {
  appendFileSync(${JSON.stringify(log)}, line + '\\n');
  const request = JSON.parse(line);
  const response = request.request_id === 'usage' ? { rate_limits_available: true, rate_limits: { five_hour: { utilization: 42 } } } : {};
  console.log(JSON.stringify({ type: 'control_response', response: { request_id: request.request_id, subtype: 'success', response } }));
});\n`);
  await chmod(cli, 0o700);
  const result = await collectUsage(cli, '/selected-profile', root, new AbortController().signal);
  assert.equal(result.windows[0]?.usedPercent, 42);
  const requests = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(requests, [
    { type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } },
    { type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } },
  ]);
});
test('quota subprocess honours cancellation and terminates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-cancel-test-'));
  const cli = join(root, 'claude');
  await writeFile(cli, `#!${process.execPath}\nsetInterval(() => {}, 10000);\n`);
  await chmod(cli, 0o700);
  const controller = new AbortController();
  const request = collectUsage(cli, null, root, controller.signal);
  controller.abort();
  await assert.rejects(request, /cancelled/);
});
test('quota output limit also catches an unterminated line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-limit-test-'));
  const cli = join(root, 'claude');
  await writeFile(cli, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(3 * 1024 * 1024)); setInterval(() => {}, 10000);\n`);
  await chmod(cli, 0o700);
  await assert.rejects(collectUsage(cli, null, root, new AbortController().signal), /output exceeded/);
});
