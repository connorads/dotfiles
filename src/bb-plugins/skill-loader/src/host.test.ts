import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, test } from 'node:test';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import entry from '../host.ts';
import { defaultPathPrefix } from './run.ts';

const harness = experimental_createHostEntryHarness(entry);
after(() => harness.experimental_dispose());

const hasSkl = (() => {
  try {
    execFileSync('skl', ['--help'], { stdio: 'ignore', env: { ...process.env, PATH: `${defaultPathPrefix().join(':')}:${process.env.PATH}` } });
    return true;
  } catch {
    return false;
  }
})();

test('the contract rejects an empty selection or a flag-shaped ref before skl runs', async () => {
  // Match the schema messages, so a rejection from skl itself cannot pass for one.
  await assert.rejects(harness.experimental_call('pointers', { refs: [] }), /expected array to have >=1 items/);
  await assert.rejects(harness.experimental_call('preview', { ref: '--all' }), /not a skl ref/);
  await assert.rejects(harness.experimental_call('pointers', { refs: ['mine/a b'] }), /not a skl ref/);
  await assert.rejects(harness.experimental_call('install', { refs: ['mine/x'], cwd: '' }), /expected string to have >=1 characters/);
});

test('the host entry lists the real catalogue and loads a whole folder', { skip: !hasSkl && 'skl not installed' }, async () => {
  const { rows } = await harness.experimental_call('list', {});
  const folder = rows.find(row => row.kind === 'folder');
  assert.ok(folder && folder.kind === 'folder');
  const { text } = await harness.experimental_call('pointers', { refs: [folder.ref] });
  assert.equal(text.match(/^Read SKILL\.md at /gm)?.length, folder.count);
});
