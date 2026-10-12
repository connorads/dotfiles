import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeArchives, type ArchivePorts } from './archive.ts';

function setup() {
  let saved: unknown;
  let status = 'idle';
  let children = 0;
  const archived: string[] = [];
  const restored: string[] = [];
  let failArchive = false;
  let failRestore = '';
  const ports: ArchivePorts = {
    get: async id => ({ id, title: id, projectId: 'p1', status, archivedAt: null }),
    children: async () => children,
    archive: async id => { if (failArchive) throw new Error('Archive failed'); archived.push(id); return children ? ['child', id] : [id]; },
    unarchive: async id => { if (id === failRestore) throw new Error('Restore failed'); restored.push(id); },
    load: async () => saved,
    save: async value => { saved = structuredClone(value); },
  };
  return { ports, archived, restored, status: (value: string) => { status = value; },
    children: (value: number) => { children = value; }, failArchive: () => { failArchive = true; },
    failRestore: (value: string) => { failRestore = value; } };
}

test('idle archive restores after a new instance loads the persistent record', async () => {
  const w = setup();
  const archive = makeArchives(w.ports);
  const target = await archive.inspect('t1');
  assert.equal((await archive.archive(target, false)).outcome, 'archived');
  assert.deepEqual(w.archived, ['t1']);
  assert.equal((await makeArchives(w.ports).restore()).outcome, 'restored');
  assert.deepEqual(w.restored, ['t1']);
});

test('running work, descendants and changed archive scope require confirmation', async () => {
  const w = setup();
  const archive = makeArchives(w.ports);
  const idle = await archive.inspect('t1');
  w.status('active');
  assert.equal((await archive.archive(idle, false)).outcome, 'confirmation');
  const active = await archive.inspect('t1');
  w.children(2);
  assert.equal((await archive.archive(active, true)).outcome, 'confirmation');
  assert.deepEqual(w.archived, []);
  assert.equal((await archive.archive(await archive.inspect('t1'), true)).outcome, 'archived');
});

test('failed archive preserves the preceding undo record', async () => {
  const w = setup();
  const archive = makeArchives(w.ports);
  await archive.archive(await archive.inspect('first'), false);
  w.failArchive();
  await assert.rejects(archive.archive(await archive.inspect('second'), false));
  await archive.restore();
  assert.deepEqual(w.restored, ['first']);
});

test('partial restoration keeps remaining children and restores owner first', async () => {
  const w = setup();
  w.children(1);
  const archive = makeArchives(w.ports);
  await archive.archive(await archive.inspect('parent'), true);
  w.failRestore('child');
  assert.equal((await archive.restore()).outcome, 'partial');
  assert.deepEqual(w.restored, ['parent']);
  w.failRestore('');
  await makeArchives(w.ports).restore();
  assert.deepEqual(w.restored, ['parent', 'child']);
});

test('repeated restore walks archives in reverse order and never repeats a completed restore', async () => {
  const w = setup();
  const archive = makeArchives(w.ports);
  for (const id of ['first', 'second']) await archive.archive(await archive.inspect(id), false);
  await archive.restore();
  await archive.restore();
  assert.equal((await archive.restore()).outcome, 'empty');
  assert.deepEqual(w.restored, ['second', 'first']);
});

test('unavailable recovery storage prevents archive before BB state changes', async () => {
  const w = setup();
  const archive = makeArchives({ ...w.ports, save: async () => { throw new Error('Storage unavailable'); } });
  await assert.rejects(archive.archive(await archive.inspect('t1'), false), /Storage unavailable/);
  assert.deepEqual(w.archived, []);
});

test('a failed receipt write reports the completed archive and retains session recovery', async () => {
  const w = setup();
  let writes = 0;
  const archive = makeArchives({ ...w.ports, save: async value => {
    if (++writes === 2) throw new Error('Storage unavailable');
    await w.ports.save(value);
  } });
  const result = await archive.archive(await archive.inspect('t1'), false);
  assert.equal(result.outcome, 'archived');
  assert.match(result.message, /Keep BB open/);
  assert.equal((await archive.restore()).outcome, 'restored');
  assert.deepEqual(w.restored, ['t1']);
});

for (const failedWrite of [3, 4]) {
  test(`restore retries a failed history write ${failedWrite} without repeating the BB action`, async () => {
    const w = setup();
    let writes = 0;
    const archive = makeArchives({ ...w.ports, save: async value => {
      if (++writes === failedWrite) throw new Error('Storage unavailable');
      await w.ports.save(value);
    } });
    await archive.archive(await archive.inspect('t1'), false);
    assert.match((await archive.restore()).message, /Keep BB open/);
    assert.equal((await archive.restore()).outcome, 'restored');
    assert.deepEqual(w.restored, ['t1']);
    assert.equal((await makeArchives(w.ports).restore()).outcome, 'empty');
  });
}
