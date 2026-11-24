import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createBoard, migrations } from './board.ts';
import type { SwarmId, ThreadId } from './domain.ts';
import { createService, type Agents, type SpawnRequest } from './service.ts';

const origin = 'thr_origin' as ThreadId;

function setup(options: { maxMembers?: number; failWakes?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  migrations.forEach(statement => db.exec(statement));
  const spawned: SpawnRequest[] = [];
  const wakes: { threadId: ThreadId; text: string; sender: ThreadId | null }[] = [];
  const stopped: ThreadId[] = [];
  const logs: string[] = [];
  const agents: Agents = {
    async spawn(request) {
      spawned.push(request);
      return `thr_${request.name}` as ThreadId;
    },
    async wake(threadId, text, sender) {
      if (options.failWakes) throw new Error('thread unavailable');
      wakes.push({ threadId, text, sender });
    },
    async stop(threadId) {
      stopped.push(threadId);
    },
  };
  let ids = 0;
  const service = createService({
    board: createBoard(db),
    agents,
    now: () => 1,
    newId: () => `swarm-${++ids}` as SwarmId,
    limits: async () => ({ maxMembers: options.maxMembers ?? 4, maxWakes: 50 }),
    log: message => logs.push(message),
  });
  const add = (name: string, threadId = origin) => service.add(threadId, { name, brief: `do ${name}`, provider: null, model: null });
  return { service, spawned, wakes, stopped, logs, add, opened: () => ids };
}

/** Lets effects started by the last call finish. */
const settled = () => new Promise(resolve => setImmediate(resolve));

test('the first add opens a swarm and spawns a worker with its brief', async () => {
  const { add, spawned, service } = setup();
  const outcome = await add('scout');
  assert.equal(outcome.ok, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]!.coordinatorThreadId, origin);
  assert.match(spawned[0]!.prompt, /do scout/);
  assert.match(service.read(origin, 0).text, /coordinator \(working\), scout \(working\)/);
});

test('parallel adds from one thread share one swarm', async () => {
  const { add, service, opened } = setup();
  const outcomes = await Promise.all([add('one'), add('two'), add('three')]);
  assert.deepEqual(outcomes.map(outcome => outcome.ok), [true, true, true]);
  assert.equal(opened(), 1);
  assert.match(service.read(origin, 0).text, /coordinator \(working\), one \(working\), two \(working\), three \(working\)/);
});

test('a refused add spawns nothing', async () => {
  const { add, spawned } = setup({ maxMembers: 2 });
  await add('one');
  assert.equal((await add('one')).ok, false);
  assert.equal((await add('two')).ok, false);
  assert.equal((await add('Not A Name!')).ok, false);
  assert.equal((await add('late', 'thr_one' as ThreadId)).ok, false);
  assert.equal(spawned.length, 1);
});

test('a worker that loses the race for a name is stopped', async () => {
  const { add, stopped } = setup();
  const outcomes = await Promise.all([add('twin'), add('twin')]);
  assert.equal(outcomes.filter(outcome => outcome.ok).length, 1);
  assert.deepEqual(stopped, ['thr_twin']);
});

test('a mention wakes the idle member with the post, attributed to its author', async () => {
  const { add, service, wakes } = setup();
  await add('scout');
  service.turnEnded(origin, 'waiting');
  const outcome = service.post('thr_scout' as ThreadId, '@coordinator found three notes');
  await settled();
  assert.match(outcome.text, /Mentioned: coordinator/);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]!.threadId, origin);
  assert.equal(wakes[0]!.sender, 'thr_scout');
  assert.match(wakes[0]!.text, /#2 scout: @coordinator found three notes/);
});

test('a post tells its author about mentions that wake nobody', async () => {
  const { add, service } = setup();
  await add('scout');
  assert.match(service.post(origin, 'thinking').text, /Nobody was mentioned/);
  assert.match(service.post(origin, '@scuot go').text, /No live member is named @scuot/);
  assert.equal(service.post('thr_stranger' as ThreadId, 'hi').ok, false);
});

test('a silent worker turn reaches the coordinator as a relayed reply', async () => {
  const { add, service, wakes } = setup();
  await add('scout');
  service.turnEnded(origin, null);
  service.turnEnded('thr_scout' as ThreadId, 'Nothing to report.');
  await settled();
  assert.match(wakes[0]!.text, /final reply relayed\): Nothing to report\./);
});

test('close stops the workers and frees the thread for a new swarm', async () => {
  const { add, service, stopped } = setup();
  await add('scout');
  assert.equal(service.close('thr_scout' as ThreadId, 'mine').ok, false);
  assert.equal(service.close(origin, 'done').ok, true);
  await settled();
  assert.deepEqual(stopped, ['thr_scout']);
  assert.equal(service.post(origin, 'more').ok, false);
  assert.equal((await add('next')).ok, true);
});

test('archiving a worker removes it; archiving the coordinator closes the swarm', async () => {
  const { add, service, stopped } = setup();
  await add('one');
  await add('two');
  service.threadGone('thr_one' as ThreadId);
  assert.match(service.read(origin, 0).text, /one \(stopped\)/);
  service.threadGone(origin);
  await settled();
  assert.deepEqual(stopped, ['thr_two']);
  assert.equal(service.read(origin, 0).ok, false);
});

test('a wake that cannot be delivered is recorded as a failed turn', async () => {
  const { add, service, logs } = setup({ failWakes: true });
  await add('scout');
  service.post('thr_scout' as ThreadId, 'note');
  service.turnEnded('thr_scout' as ThreadId, null);
  service.post(origin, '@scout continue');
  await settled();
  assert.match(service.read(origin, 0).text, /scout \(failed\)/);
  assert.match(logs[0]!, /wake scout failed: thread unavailable/);
});
