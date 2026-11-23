import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAntigravityUsage, parseAntigravityUsage } from './antigravity.ts';

function reply(remaining = 0.7) {
  return { status: 'SUCCESS', num_turns: 0, usage: { total_tokens: 0 }, command: { name: 'usage', data: { groups: [
    { name: 'Example models', buckets: [
      { id: 'example-weekly', name: 'Weekly remaining', window: 'weekly', remaining_fraction: remaining, reset_time: '2027-01-08T12:00:00Z' },
      { id: 'example-5h', name: 'Session remaining', window: '5h', remaining_fraction: 0, reset_time: '2027-01-02T12:00:00Z' },
    ] },
  ] } } };
}

test('Antigravity preserves quota groups, periods and resets and converts remaining to used', () => {
  const reading = parseAntigravityUsage(reply(), 123);
  assert.equal(reading.observedAt, 123);
  assert.equal(reading.usage.status, 'ok');
  if (reading.usage.status !== 'ok') assert.fail('Expected usage');
  assert.equal(reading.usage.accountEmail, null);
  assert.deepEqual(reading.usage.windows.map(window => [window.label, window.kind, window.usedPercent, window.resetsAt]), [
    ['Example models · Weekly', 'weekly', 30, '2027-01-08T12:00:00Z'],
    ['Example models · 5-hour', 'five-hour', 100, '2027-01-02T12:00:00Z'],
  ]);
});
test('Antigravity skips disabled buckets that omit reset_time when another window is exhausted', () => {
  const exhausted = { status: 'SUCCESS', num_turns: 0, usage: { total_tokens: 0 }, command: { name: 'usage', data: { groups: [
    { name: 'Claude and GPT models', buckets: [
      { id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0, reset_time: '2026-11-29T07:41:23Z' },
      { id: '3p-5h', name: 'Five Hour Limit Remaining', window: '5h', disabled: true, remaining_fraction: 1 },
    ] },
  ] } } };
  const reading = parseAntigravityUsage(exhausted, 456);
  assert.equal(reading.usage.status, 'ok');
  if (reading.usage.status !== 'ok') assert.fail('Expected usage');
  assert.deepEqual(reading.usage.windows.map(w => [w.id, w.usedPercent, w.resetsAt]), [
    ['3p-weekly', 100, '2026-11-29T07:41:23Z'],
  ]);
});
test('Antigravity rejects missing quotas, duplicates and accidental model calls', () => {
  for (const remaining of [-1, 2, NaN]) assert.throws(() => parseAntigravityUsage(reply(remaining)));
  const duplicate = reply();
  duplicate.command.data.groups.push(duplicate.command.data.groups[0]!);
  assert.throws(() => parseAntigravityUsage(duplicate));
  assert.throws(() => parseAntigravityUsage({ ...reply(), num_turns: 1 }));
  assert.throws(() => parseAntigravityUsage({ ...reply(), command: { name: 'usage', data: { groups: [] } } }));
});

async function cli(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'antigravity-test-'));
  const path = join(directory, 'cli.mjs');
  await writeFile(path, body);
  return [process.execPath, path];
}
test('collector uses only the native quota command outside the workspace', async () => {
  const command = await cli(`
    import assert from 'node:assert/strict';
    assert.deepEqual(process.argv.slice(2), ['--print','/usage','--output-format','json','--print-timeout','20s']);
    assert.notEqual(process.cwd(), ${JSON.stringify(process.cwd())});
    console.log(${JSON.stringify(JSON.stringify(reply()))});
  `);
  assert.equal((await collectAntigravityUsage({ command })).usage.status, 'ok');
});
test('collector bounds hangs and output, handles missing CLI and never exposes raw errors', async () => {
  const missing = await collectAntigravityUsage({ command: ['/nonexistent/agy'] });
  assert.equal(missing.usage.status, 'not_installed');
  for (const body of ['setInterval(()=>{},1000)', "console.log('private-output'.repeat(100000))", "console.error('private-output'); process.exit(1)"]) {
    const reading = await collectAntigravityUsage({ command: await cli(body), timeoutMs: 150 });
    assert.equal(reading.usage.status, 'error');
    assert.equal(JSON.stringify(reading).includes('private-output'), false);
  }
});
test('the native signed-out error on stderr offers authentication', async () => {
  const command = await cli(`
    console.log(JSON.stringify({ status: 'ERROR', error: 'No supported credentials' }));
    console.error("Error: authentication required. Run 'agy' to log in, then retry.");
    process.exit(1);
  `);
  assert.equal((await collectAntigravityUsage({ command })).usage.status, 'unauthenticated');
});

test('collector does not launch when cancelled', async () => {
  const reading = await collectAntigravityUsage({ command: ['/nonexistent/agy'], signal: AbortSignal.abort() });
  assert.equal(reading.usage.status, 'error');
});
