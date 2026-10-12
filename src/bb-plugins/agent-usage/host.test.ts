import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readResetCredits } from './host.ts';

test('cache-only reads the tmux cache timestamp without running the collector', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  await mkdir(join(root, '.cache'));
  await writeFile(join(root, '.cache/codex-usage.json'), JSON.stringify({ email: 'cli@example.com',
    rate_limit_reset_credits: { available_count: 3, applicable_available_count: 0 } }));
  let runs = 0;
  const value = await readResetCredits(root, false, async () => { runs++; return true; });
  expect(value).toMatchObject({ status: 'ok', accountLabel: 'cli@example.com', held: 3, usable: 0 });
  expect(value.status === 'ok' && value.observedAt).toBeGreaterThan(0);
  expect(runs).toBe(0);
});

test('failed refresh keeps the old reading and reports failure; a missing cache is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  expect(await readResetCredits(root, false, async () => true)).toMatchObject({ status: 'unavailable' });
  await mkdir(join(root, '.cache'));
  await writeFile(join(root, '.cache/codex-usage.json'), JSON.stringify({
    rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 } }));
  let runs = 0;
  expect(await readResetCredits(root, true, async () => { runs++; return false; }))
    .toMatchObject({ status: 'ok', held: 1, message: 'Reset-credit refresh failed. Showing the cached reading.' });
  expect(runs).toBe(1);
});

test('an unchanged cache after a requested refresh is labelled as cached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reset-credits-'));
  await mkdir(join(root, '.cache'));
  await writeFile(join(root, '.cache/codex-usage.json'), JSON.stringify({
    rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 } }));
  expect(await readResetCredits(root, true, async () => true))
    .toMatchObject({ status: 'ok', message: 'Collector kept the cached reading. Refresh may be paused.' });
});
