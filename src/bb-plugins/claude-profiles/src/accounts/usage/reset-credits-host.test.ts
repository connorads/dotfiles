import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readResetCredits } from './reset-credits-host.ts';

test('cache-only reads the tmux cache timestamp without running the collector', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  await mkdir(join(root, '.cache'));
  await writeFile(join(root, '.cache/codex-usage.json'), JSON.stringify({ email: 'cli@example.com',
    rate_limit_reset_credits: { available_count: 3, applicable_available_count: 0 } }));
  let runs = 0;
  const value = await readResetCredits(root, false, async () => { runs++; return true; });
  assert.partialDeepStrictEqual(value, { status: 'ok', accountLabel: 'cli@example.com', held: 3, usable: 0 });
  assert.ok(value.status === 'ok' && value.observedAt > 0);
  assert.equal(runs, 0);
});

test('failed refresh keeps the old reading and reports failure; a missing cache is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  assert.equal((await readResetCredits(root, false, async () => true)).status, 'unavailable');
  await mkdir(join(root, '.cache'));
  await writeFile(join(root, '.cache/codex-usage.json'), JSON.stringify({
    rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 } }));
  let runs = 0;
  assert.partialDeepStrictEqual(await readResetCredits(root, true, async () => { runs++; return false; }),
    { status: 'ok', held: 1, message: 'Reset-credit refresh failed. Showing the cached reading.' });
  assert.equal(runs, 1);
});

test('an unchanged cache after a requested refresh is labelled as cached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  await mkdir(join(root, '.cache'));
  await writeFile(join(root, '.cache/codex-usage.json'), JSON.stringify({
    rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 } }));
  assert.partialDeepStrictEqual(await readResetCredits(root, true, async () => true),
    { status: 'ok', message: 'Collector kept the cached reading. Refresh may be paused.' });
});

test('ordinary reads collect missing or five-minute-old credits without tmux', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  await mkdir(join(root, '.cache'));
  const path = join(root, '.cache/codex-usage.json');
  let runs = 0;
  const collect = async () => {
    runs++;
    await writeFile(path, JSON.stringify({ rate_limit_reset_credits: {
      available_count: 2, applicable_available_count: 1 } }));
    return true;
  };
  assert.partialDeepStrictEqual(await readResetCredits(root, false, collect), { status: 'ok', held: 2 });
  assert.equal(runs, 1);
  await readResetCredits(root, false, collect);
  assert.equal(runs, 1);
  const old = new Date(Date.now() - 301_000);
  await utimes(path, old, old);
  await readResetCredits(root, false, collect);
  assert.equal(runs, 2);
});
