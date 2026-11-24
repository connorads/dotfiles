import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../../bin/codex-reset', import.meta.url));
const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'codex-reset-'));
  const log = join(home, 'requests');
  const fake = join(home, 'codex');
  symlinkSync(python, join(home, 'python3'));
  writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const { id, method, params } = JSON.parse(line);
  fs.appendFileSync(process.env.REQUESTS, JSON.stringify({ method, params }) + '\\n');
  if (id === undefined) return;
  let result = {};
  if (method === 'account/rateLimits/read') result = {
    accountId: process.env.ACCOUNT || 'account-test', ordinaryUsageAllowed: process.env.ALLOWED !== 'false',
    rateLimitResetCredits: { availableCount: 3 },
    rateLimits: { limitId: 'codex', primary: { usedPercent: Number(process.env.USED), windowDurationMins: 300 },
      secondary: { usedPercent: 15, windowDurationMins: 10080 } },
  };
  if (method === 'account/rateLimitResetCredit/consume') result = { outcome: process.env.OUTCOME || 'reset' };
  process.stdout.write(JSON.stringify({ id, result }) + '\\n');
});
`);
  chmodSync(fake, 0o700);
  const run = (args: string[], env: Record<string, string> = {}) => JSON.parse(execFileSync(cli, args, {
    encoding: 'utf8', env: { HOME: home, PATH: `${home}:${process.env.PATH}`, REQUESTS: log, USED: '80', ...env },
  }));
  const attempts = () => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(request => request.method === 'account/rateLimitResetCredit/consume');
  return { run, attempts, log };
}

test('one-shot waits at 80%, previews at 98%, and disarms after one confirmed reset', () => {
  const { run, attempts, log } = fixture();
  assert.equal(run(['status']).mode, 'off');
  assert.equal(run(['check']).mode, 'off');
  assert.equal(existsSync(log), false);
  assert.equal(run(['arm', 'once', '--trigger', '98']).mode, 'once');
  assert.equal(run(['check']).mode, 'once');
  assert.match(run(['check', '--dry-run'], { USED: '98' }).message, /Would redeem/);
  assert.equal(attempts().length, 0);
  assert.equal(run(['check'], { USED: '98' }).mode, 'off');
  run(['check'], { USED: '100' });
  assert.equal(attempts().length, 1);
  assert.match(attempts()[0].params.idempotencyKey, /^[a-f0-9-]{36}$/);
});

test('always waits for usage to recover and refuses to redeem for a changed account', () => {
  const { run, attempts } = fixture();
  run(['arm', 'always', '--trigger', 'blocked']);
  run(['check'], { USED: '100' });
  run(['check'], { ALLOWED: 'false' });
  run(['arm', 'always', '--trigger', 'blocked'], { ALLOWED: 'false' });
  run(['check'], { ALLOWED: 'false' });
  assert.equal(attempts().length, 1);
  run(['check']);
  run(['check'], { ALLOWED: 'false' });
  assert.equal(attempts().length, 2);
  run(['check']);
  assert.equal(run(['check'], { ACCOUNT: 'different-account', ALLOWED: 'false' }).mode, 'off');
  assert.equal(attempts().length, 2);
});

test('an unknown redemption response pauses all automatic checks until reviewed', () => {
  const { run, attempts } = fixture();
  run(['arm', 'once', '--trigger', '98']);
  assert.equal(run(['check'], { USED: '98', OUTCOME: 'unknown' }).mode, 'off');
  assert.equal(run(['status']).review, true);
  run(['check'], { USED: '100' });
  assert.equal(attempts().length, 1);
  assert.equal(run(['off']).review, false);
});
