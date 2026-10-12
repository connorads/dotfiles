// The host's lib driver against the real caffeine-lib.sh, through the
// stand-ins in fixture.ts.
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { alive, clearFlags, exists, home, pidfile, restore, root, skip, stubbedPath, stubPids, touch, untouch } from './fixture.ts';
import { createCaffeineHost } from './lib.ts';
import type { LibStatus } from './domain.ts';

const host = createCaffeineHost();
const on = (status: LibStatus) => {
  assert.equal(status.kind, 'on');
  return status as Extract<LibStatus, { kind: 'on' }>;
};

beforeEach(async () => {
  if (skip) return;
  await host.stop();
  await clearFlags();
});

after(async () => {
  if (!skip) await host.stop();
  await restore();
});

test('status reads OFF with no pidfile', { skip }, async () => {
  assert.deepEqual(await host.status(), { kind: 'off' });
});

test('an indefinite start is ON with no deadline, then stop is OFF', { skip }, async () => {
  assert.deepEqual(await host.start(0), { ok: true });
  const status = on(await host.status());
  assert.equal(status.deadline, null);
  assert.equal(status.lid, false);
  assert.equal(status.owner, null);
  assert.ok(alive(status.pid));
  assert.deepEqual(await host.stop(), { ok: true });
  assert.deepEqual(await host.status(), { kind: 'off' });
  assert.equal(alive(status.pid), false);
});

test('a timed start records its deadline and start time', { skip }, async () => {
  const before = Date.now();
  await host.start(600);
  const status = on(await host.status());
  assert.ok(Math.abs(status.deadline! - (before + 600_000)) < 3_000);
  assert.ok(Math.abs(status.startedAt - before) < 3_000);
});

test('extend adds to what is left', { skip }, async () => {
  await host.start(600);
  const first = on(await host.status());
  assert.deepEqual(await host.extend(1800), { ok: true });
  const second = on(await host.status());
  assert.ok(Math.abs(second.deadline! - (first.deadline! + 1_800_000)) < 3_000);
  assert.notEqual(second.pid, first.pid);
});

test('extend refuses an indefinite session and an empty one', { skip }, async () => {
  assert.deepEqual(await host.extend(1800), { ok: false, reason: 'Nothing is running to extend.', stoppedPrevious: false });
  await host.start(0);
  assert.deepEqual(await host.extend(1800), { ok: false, reason: 'An indefinite session has nothing to extend.', stoppedPrevious: false });
  assert.equal(on(await host.status()).deadline, null);
});

test('a lid start that sudo refuses explains and leaves it off', { skip }, async () => {
  await touch('sudo-refuses');
  const result = await host.startLid(600);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /SleepDisabled flag did not take/);
  assert.deepEqual(await host.status(), { kind: 'off' });
});

test('a permitted lid start raises the flag, and stop clears it', { skip }, async () => {
  assert.deepEqual(await host.startLid(600), { ok: true });
  assert.equal(on(await host.status()).lid, true);
  assert.equal((await host.details()).sleepDisabled, true);
  await host.stop();
  assert.equal((await host.details()).sleepDisabled, false);
});

test('details read the power source', { skip }, async () => {
  assert.deepEqual(await host.details(), { sleepDisabled: false, onBattery: false });
  await touch('on-battery');
  assert.equal((await host.details()).onBattery, true);
});

test('a stale pidfile reads OFF', { skip }, async () => {
  await writeFile(pidfile, '999999 0 idle\n');
  assert.deepEqual(await host.status(), { kind: 'off' });
});

test('an owned start records bb-agents', { skip }, async () => {
  assert.deepEqual(await host.startOwned(3600), { ok: true });
  assert.equal(on(await host.status()).owner, 'bb-agents');
  assert.equal(await host.renewOwned(3600), 'renewed');
  assert.equal(on(await host.status()).owner, 'bb-agents');
  assert.equal(await host.stopOwned(), 'stopped');
  assert.deepEqual(await host.status(), { kind: 'off' });
});

test('renew and stop leave a manual session alone', { skip }, async () => {
  await host.start(600);
  const manual = on(await host.status());
  assert.equal(await host.renewOwned(3600), 'not-owned');
  assert.equal(await host.stopOwned(), 'not-owned');
  const still = on(await host.status());
  assert.equal(still.pid, manual.pid);
  assert.ok(alive(manual.pid));
  assert.equal(still.owner, null);
});

test('clear fixes a stuck flag, says when sudo refuses, and when nothing is stuck', { skip }, async () => {
  assert.deepEqual(await host.clear(), { ok: false, reason: 'Nothing to clear.', stoppedPrevious: false });
  await touch('sleepdisabled');
  await touch('sudo-refuses');
  assert.match((await host.clear() as { reason: string }).reason, /sudo refused/);
  await untouch('sudo-refuses');
  await touch('flag-sticks');
  assert.match((await host.clear() as { reason: string }).reason, /will not clear/);
  await untouch('flag-sticks');
  assert.deepEqual(await host.clear(), { ok: true });
  assert.equal(await exists(join(home, 'sleepdisabled')), false);
});

test('a caffeinate that dies at once is a failed start', { skip }, async () => {
  await touch('caffeinate.dies');
  assert.deepEqual(await host.start(600), { ok: false, reason: 'caffeinate did not start.', stoppedPrevious: false });
});

test('two starts at once leave one live caffeinate and no orphan', { skip }, async () => {
  const before = new Set(await stubPids());
  await Promise.all([host.start(600), host.start(1200)]);
  const started = (await stubPids()).filter(pid => !before.has(pid));
  assert.equal(started.length, 2);
  const live = on(await host.status());
  assert.deepEqual(started.filter(alive), [live.pid]);
});

test('a missing lib is unsupported', { skip }, async () => {
  process.env.HOME = root;
  try { assert.deepEqual(await host.status(), { kind: 'unsupported', reason: 'no-lib' }); }
  finally { process.env.HOME = home; }
});

test('no caffeinate on PATH is unsupported', { skip }, async () => {
  process.env.PATH = join(root, 'empty');
  try { assert.deepEqual(await host.status(), { kind: 'unsupported', reason: 'no-caffeinate' }); }
  finally { process.env.PATH = stubbedPath; }
});

test('another platform is unsupported without running anything', async () => {
  assert.deepEqual(await createCaffeineHost('linux').status(), { kind: 'unsupported', reason: 'not-macos' });
});
