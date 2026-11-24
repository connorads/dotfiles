import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createBoard, migrations } from './board.ts';
import { coordinatorName, openSwarm, type MemberName, type Swarm, type SwarmId, type ThreadId } from './domain.ts';
import { decide, type Input } from './engine.ts';

const id = 'swarm-1' as SwarmId;
const a = 'a' as MemberName;
const coordinatorThread = 'thr_coordinator' as ThreadId;
const workerThread = 'thr_a' as ThreadId;

function setup() {
  const db = new DatabaseSync(':memory:');
  migrations.forEach(statement => db.exec(statement));
  const board = createBoard(db);
  const swarm = openSwarm(coordinatorThread, { maxMembers: 4, maxWakes: 50 });
  board.create(id, swarm, 1);
  return { board, swarm };
}

/** Applies one input and saves it, as the plugin does for every command and event. */
function apply(board: ReturnType<typeof createBoard>, swarm: Swarm, input: Input): Swarm {
  const decision = decide(swarm, input);
  if (!decision.ok) throw new Error(decision.error.code);
  board.save(id, swarm, decision.swarm);
  return decision.swarm;
}

const join: Input = { type: 'join', at: 2, by: coordinatorName, name: a, threadId: workerThread, brief: 'map the notes' };

test('a new swarm loads back as it was created', () => {
  const { board, swarm } = setup();
  assert.deepEqual(board.load(id), swarm);
  assert.equal(board.load('missing' as SwarmId), null);
});

test('every kind of entry and member change survives a save', () => {
  const { board, swarm } = setup();
  let current = apply(board, swarm, join);
  current = apply(board, current, { type: 'turnEnded', at: 3, member: coordinatorName, lastReply: null });
  current = apply(board, current, { type: 'post', at: 4, author: a, text: 'half way, @coordinator' });
  current = apply(board, current, { type: 'turnFailed', at: 5, member: a, error: 'quota' });
  current = apply(board, current, { type: 'turnStarted', at: 6, member: a });
  current = apply(board, current, { type: 'turnEnded', at: 7, member: a, lastReply: 'done' });
  current = apply(board, current, { type: 'turnEnded', at: 8, member: coordinatorName, lastReply: null });
  current = apply(board, current, { type: 'turnEnded', at: 9, member: coordinatorName, lastReply: null });
  current = apply(board, current, { type: 'gone', at: 10, member: a });
  current = apply(board, current, { type: 'close', at: 11, by: 'human', summary: 'enough' });
  assert.deepEqual(current.entries.map(entry => entry.kind), ['joined', 'post', 'failed', 'reply', 'post', 'left', 'closed']);
  assert.deepEqual(board.load(id), current);
});

test('a thread finds its open swarm until it leaves or the swarm closes', () => {
  const { board, swarm } = setup();
  assert.equal(board.openFor(coordinatorThread), id);
  assert.equal(board.openFor(workerThread), null);

  const joined = apply(board, swarm, join);
  assert.equal(board.openFor(workerThread), id);

  const left = apply(board, joined, { type: 'gone', at: 3, member: a });
  assert.equal(board.openFor(workerThread), null);

  apply(board, left, { type: 'close', at: 4, by: coordinatorName, summary: 'done' });
  assert.equal(board.openFor(coordinatorThread), null);
});
