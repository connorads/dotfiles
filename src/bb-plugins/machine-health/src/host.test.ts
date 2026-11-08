// Integration: the real host entry on this machine, through the SDK harness.
// Figures vary by machine; the contract does not. The CPU window logic is unit-tested in cpu.test.ts.
import { execFileSync, spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import entry, { toolPath } from '../host.ts';
import { parseProcessTimes } from './services.ts';
import { sampleSchema, triageSampleSchema } from '../contracts.ts';

test('the host entry returns contract-valid samples, with CPU on the second call', async () => {
  const harness = experimental_createHostEntryHarness(entry);
  try {
    const cold = await harness.experimental_call('sample', {});
    assert.equal(sampleSchema.safeParse(cold).success, true);
    assert.ok(cold.vitals.disk, 'statfs of $HOME should always read');
    await new Promise(resolve => setTimeout(resolve, 300));
    const warm = await harness.experimental_call('sample', {});
    assert.notEqual(warm.vitals.cpuPct, null);
    assert.ok(warm.vitals.sampledAt >= cold.vitals.sampledAt);
  } finally {
    await harness.experimental_dispose();
  }
});

/** The agent sandbox refuses `ps` (spawn EPERM); the triage test needs a readable process table. */
const psReadable = (() => {
  try { return execFileSync('/bin/ps', ['-o', 'pid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim() !== ''; } catch { return false; }
})();

test('on macOS, triage returns contract-valid footprints and process work stays read-only', {
  skip: process.platform !== 'darwin' ? 'macOS tools only' : !psReadable ? 'ps is not readable here (sandbox)' : false,
}, async () => {
  const harness = experimental_createHostEntryHarness(entry);
  try {
    const sample = await harness.experimental_call('triage', {});
    assert.equal(triageSampleSchema.safeParse(sample).success, true);
    assert.ok(sample.apps.length > 0, 'top should report footprints');
    const known = await harness.experimental_call('processes', { threadIds: sample.threads.map(thread => thread.threadId) });
    assert.ok(known.threads.every(thread => sample.threads.some(row => row.threadId === thread.threadId)));
    const refused = await harness.experimental_call('terminate', { pid: 1, command: 'launchd', started: 'unknown' });
    assert.equal(refused.ok, false);
  } finally {
    await harness.experimental_dispose();
  }
});

test('tool PATH puts system dirs first and reaches NixOS tools', () => {
  const dirs = toolPath('/evil:/usr/bin:/home/c/.nix-profile/bin').split(':');
  assert.deepEqual(dirs.slice(0, 5), ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/run/current-system/sw/bin']);
  assert.deepEqual(dirs.slice(5), ['/evil', '/home/c/.nix-profile/bin']);
});


test('termination refuses a changed identity and confirms a disposable child exits', {
  skip: process.platform !== 'darwin' || !psReadable ? 'requires readable macOS processes' : false,
}, async () => {
  const harness = experimental_createHostEntryHarness(entry);
  const child = spawn('/bin/sleep', ['60']);
  try {
    assert.ok(child.pid);
    const pid = child.pid;
    const table = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pid=,lstart=,etime='], { encoding: 'utf8' });
    const started = parseProcessTimes(table).get(pid)!.started;
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    const refused = await harness.experimental_call('terminate', { pid, command, started: 'different' });
    assert.equal(refused.ok, false);
    assert.equal(child.exitCode, null);
    const outcome = await harness.experimental_call('terminate', { pid, command, started });
    assert.deepEqual(outcome, { ok: true, outcome: 'exited' });
  } finally {
    child.kill('SIGTERM');
    await harness.experimental_dispose();
  }
});
