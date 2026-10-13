import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectGrokUsage } from './grok.ts';

async function withCli(mode: string, run: (command: string[], record: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'grok-test-'));
  const record = join(dir, 'record.json');
  const script = join(dir, 'cli.mjs');
  await writeFile(script, `
    import { createInterface } from 'node:readline';
    import { writeFileSync } from 'node:fs';
    const requests = [];
    process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(record)}, JSON.stringify({requests, cwd: process.cwd(), args: process.argv.slice(2), pid: process.pid})); if (${JSON.stringify(mode)} !== 'stubborn') process.exit(0); });
    createInterface({input:process.stdin}).on('line', line => {
      const request = JSON.parse(line); requests.push(request);
      if (request.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{protocolVersion:1}})+'\\n');
      else if (${JSON.stringify(mode)} === 'oversize') process.stdout.write('x'.repeat(1_048_577));
      else if (['timeout', 'stubborn'].includes(${JSON.stringify(mode)})) { process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notification',params:{}})+'\\n'); }
      else if (${JSON.stringify(mode)} === 'auth') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'secret-token'}})+'\\n');
      else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{config:{creditUsagePercent:${mode === 'missing' ? 'undefined' : mode === 'overage' ? '103' : '3'},currentPeriod:{type:'USAGE_PERIOD_TYPE_WEEKLY',end:'2026-10-18T01:19:06.310955+00:00'}},subscription_tier:'X Premium+'}})+'\\n');
    });
  `);
  try { await run([process.execPath, script], record); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('Grok collects shared quota through ACP without creating a session and reaps the CLI', async () => {
  await withCli('ok', async (command, record) => {
    const result = await collectGrokUsage({ command });
    assert.equal(result.usage.status, 'ok');
    if (result.usage.status !== 'ok') assert.fail('Expected quota');
    assert.equal(result.usage.planLabel, 'X Premium+');
    assert.deepEqual(result.usage.windows, [{ id: 'shared', label: 'Weekly', kind: 'weekly', usedPercent: 3,
      resetsAt: '2026-10-18T01:19:06.310955+00:00', model: null, cost: null }]);
    const state = JSON.parse(await readFile(record, 'utf8'));
    assert.deepEqual(state.requests.map((request: { method: string }) => request.method), ['initialize', '_x.ai/billing']);
    assert.deepEqual(state.args, ['agent', '--no-leader', 'stdio']);
    assert.notEqual(state.cwd, process.cwd());
    assert.throws(() => process.kill(state.pid, 0));
  });
});

for (const mode of ['auth', 'missing', 'timeout', 'stubborn', 'oversize']) {
  test(`Grok reports ${mode} as unavailable and reaps the CLI`, async () => {
    await withCli(mode, async (command, record) => {
      const result = await collectGrokUsage({ command, timeoutMs: ['timeout', 'stubborn'].includes(mode) ? 200 : 2000 });
      assert.equal(result.usage.status, 'error');
      assert.equal(result.observedAt, null);
      assert.equal(JSON.stringify(result).includes('secret-token'), false);
      const state = JSON.parse(await readFile(record, 'utf8'));
      assert.throws(() => process.kill(state.pid, 0));
    });
  });
}

test('Grok reports a missing executable as unavailable', async () => {
  const result = await collectGrokUsage({ command: ['/nonexistent/grok'] });
  assert.equal(result.usage.status, 'error');
});

test('Grok preserves reported quota overage', async () => {
  await withCli('overage', async command => {
    const result = await collectGrokUsage({ command });
    assert.equal(result.usage.status, 'ok');
    if (result.usage.status === 'ok') assert.equal(result.usage.windows[0]?.usedPercent, 103);
  });
});

test('Grok cancellation stops and reaps an in-flight CLI', async () => {
  await withCli('timeout', async (command, record) => {
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), 200);
    try {
      const result = await collectGrokUsage({ command, signal: controller.signal });
      assert.equal(result.usage.status, 'error');
      if (result.usage.status === 'error') assert.match(result.usage.message, /cancelled/);
      const state = JSON.parse(await readFile(record, 'utf8'));
      assert.throws(() => process.kill(state.pid, 0));
    } finally { clearTimeout(cancel); }
  });
});
