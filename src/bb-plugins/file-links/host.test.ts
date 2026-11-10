import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import { expect, it } from 'vitest';
import entry from './host';

it('checks only the requested file without walking sibling directories', async () => {
  const root = await mkdtemp(join(tmpdir(),'file-links-'));
  await mkdir(join(root,'unrelated'));
  await writeFile(join(root,'unrelated','chart.png'),'sibling');
  await writeFile(join(root,'chart.png'),'exact');
  const harness = experimental_createHostEntryHarness(entry);
  try {
    expect(await harness.experimental_call('exists',{path:join(root,'chart.png')})).toBe(true);
    expect(await harness.experimental_call('exists',{path:join(root,'missing.png')})).toBe(false);
    expect(await harness.experimental_call('exists',{path:join(root,'unrelated')})).toBe(false);
    expect(await harness.experimental_call('exists',{path:join(root,'missing','chart.png')})).toBe(false);
  } finally { await harness.experimental_dispose(); }
});
