import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coordinatorName,
  openSwarm,
  type Entry,
  type MemberName,
  type Swarm,
  type ThreadId,
} from './domain.ts';
import { decide, type Effect, type Input } from './engine.ts';

const a = 'a' as MemberName;
const b = 'b' as MemberName;
const thread = (name: string) => `thr_${name}` as ThreadId;

type Step = Input extends infer I ? (I extends unknown ? Omit<I, 'at'> : never) : never;

/** Applies inputs in order and fails the test on a refused command. */
function run(swarm: Swarm, ...steps: Step[]): { swarm: Swarm; effects: Effect[] } {
  let effects: Effect[] = [];
  for (const step of steps) {
    const decision = decide(swarm, { ...step, at: 1 } as Input);
    assert.equal(decision.ok, true, JSON.stringify(decision));
    if (!decision.ok) throw new Error('unreachable');
    swarm = decision.swarm;
    effects = decision.effects;
  }
  return { swarm, effects };
}

function refuse(swarm: Swarm, step: Step): string {
  const decision = decide(swarm, { ...step, at: 1 } as Input);
  assert.equal(decision.ok, false);
  return decision.ok ? '' : decision.error.code;
}

const fresh = (limits = { maxMembers: 4, maxWakes: 50 }) => openSwarm(thread('coordinator'), limits);
const join = (name: MemberName, by = coordinatorName): Step => ({ type: 'join', by, name, threadId: thread(name), brief: `do ${name}` });
const post = (author: MemberName | 'human', text: string): Step => ({ type: 'post', author, text });
const ended = (member: MemberName, lastReply: string | null = null): Step => ({ type: 'turnEnded', member, lastReply });
const wakes = (effects: Effect[]) => effects.filter(effect => effect.type === 'wake');
const kinds = (entries: readonly Entry[]) => entries.map(entry => entry.kind);
const member = (swarm: Swarm, name: MemberName) => swarm.members.find(m => m.name === name)!;

test('join records the brief and starts the worker working', () => {
  const { swarm, effects } = run(fresh(), join(a));
  assert.deepEqual(kinds(swarm.entries), ['joined']);
  assert.equal(member(swarm, a).run, 'working');
  assert.equal(member(swarm, a).cursor, 1);
  assert.deepEqual(effects, []);
});

test('join is refused for a worker, a taken name and a full swarm', () => {
  const { swarm } = run(fresh({ maxMembers: 2, maxWakes: 50 }), join(a));
  assert.equal(refuse(swarm, join(b, a)), 'not-coordinator');
  assert.equal(refuse(swarm, join(a)), 'name-taken');
  assert.equal(refuse(swarm, join(b)), 'member-limit');
});

test('a mention wakes an idle member with the post and moves its cursor', () => {
  const { swarm, effects } = run(fresh(), join(a), post(a, 'working on it'), ended(a), post(coordinatorName, '@a try again'));
  assert.equal(effects.length, 1);
  const wake = effects[0]!;
  assert.equal(wake.type === 'wake' && wake.member, a);
  assert.deepEqual(wake.type === 'wake' && wake.entries.map(entry => entry.seq), [3]);
  assert.equal(member(swarm, a).run, 'working');
  assert.equal(member(swarm, a).cursor, 3);
  assert.equal(swarm.wakes, 1);
});

test('a post that mentions nobody wakes nobody', () => {
  const { effects } = run(fresh(), join(a), post(a, 'note'), ended(a), post(coordinatorName, 'thinking'));
  assert.deepEqual(effects, []);
});

test('mentions that arrive during a turn are delivered once, together, when it ends', () => {
  const during = run(fresh(), join(a), post(coordinatorName, '@a one'), post(coordinatorName, '@a two'));
  assert.deepEqual(during.effects, []);
  const { effects } = run(during.swarm, post(a, 'progress'), ended(a));
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0]!.type === 'wake' && effects[0]!.entries.map(entry => entry.seq), [2, 3]);
});

test('@all wakes every idle member except the author', () => {
  const setup = run(fresh(), join(a), join(b), post(a, 'x'), ended(a), post(b, 'y'), ended(b));
  const { effects } = run(setup.swarm, post(coordinatorName, '@all stop'));
  assert.deepEqual(wakes(effects).map(effect => effect.member).sort(), [a, b]);
});

test('a worker turn that ends without a post is relayed to the coordinator', () => {
  const { swarm, effects } = run(fresh(), join(a), ended(coordinatorName), ended(a, 'all done'));
  const last = swarm.entries.at(-1)!;
  assert.deepEqual([last.kind, last.kind === 'reply' && last.text], ['reply', 'all done']);
  assert.deepEqual(wakes(effects).map(effect => effect.member), [coordinatorName]);
});

test('a worker that posted during its turn is not relayed', () => {
  const { swarm } = run(fresh(), join(a), post(a, '@coordinator done'), ended(a, 'all done'));
  assert.deepEqual(kinds(swarm.entries), ['joined', 'post']);
});

test('a quiet board gets one stall notice, then silence', () => {
  const quiet = run(fresh(), join(a), post(a, 'note'), ended(a), ended(coordinatorName));
  const notice = quiet.swarm.entries.at(-1)!;
  assert.equal(notice.kind === 'post' && notice.author, 'engine');
  assert.deepEqual(wakes(quiet.effects).map(effect => effect.member), [coordinatorName]);

  const again = run(quiet.swarm, ended(coordinatorName));
  assert.deepEqual(again.effects, []);
  assert.equal(again.swarm.entries.length, quiet.swarm.entries.length);
});

test('a stall is not declared while a member is still working', () => {
  const { swarm, effects } = run(fresh(), join(a), ended(coordinatorName));
  assert.deepEqual(effects, []);
  assert.deepEqual(kinds(swarm.entries), ['joined']);
});

test('a failed worker is reported to the coordinator and can resume', () => {
  const { swarm, effects } = run(fresh(), join(a), ended(coordinatorName), { type: 'turnFailed', member: a, error: 'quota' });
  assert.equal(member(swarm, a).run, 'failed');
  assert.equal(swarm.entries.at(-1)!.kind, 'failed');
  assert.deepEqual(wakes(effects).map(effect => effect.member), [coordinatorName]);

  const resumed = run(swarm, { type: 'turnStarted', member: a });
  assert.equal(member(resumed.swarm, a).run, 'working');
});

test('a member whose thread is gone leaves and is no longer woken', () => {
  const { swarm } = run(fresh(), join(a), { type: 'gone', member: a });
  assert.equal(member(swarm, a).run, 'stopped');
  const { effects } = run(swarm, post(coordinatorName, '@all hello'));
  assert.deepEqual(effects, []);
});

test('close stops every live worker and refuses later commands', () => {
  const { swarm, effects } = run(fresh(), join(a), join(b), { type: 'gone', member: b }, { type: 'close', by: coordinatorName, summary: 'shipped' });
  assert.deepEqual(effects, [{ type: 'stop', member: a, threadId: thread('a') }]);
  assert.equal(swarm.entries.at(-1)!.kind, 'closed');
  assert.equal(refuse(swarm, post(coordinatorName, 'more')), 'closed');
  assert.equal(refuse(swarm, join(b)), 'closed');
  assert.deepEqual(run(swarm, ended(a, 'late')).swarm, swarm);
});

test('only the coordinator or the human can close', () => {
  const { swarm } = run(fresh(), join(a));
  assert.equal(refuse(swarm, { type: 'close', by: a, summary: 'mine' }), 'not-coordinator');
  assert.equal(run(swarm, { type: 'close', by: 'human', summary: 'enough' }).swarm.entries.at(-1)!.kind, 'closed');
});

test('a human post that names nobody goes to the coordinator', () => {
  const { effects } = run(fresh(), join(a), ended(coordinatorName), post('human', 'how is it going?'));
  assert.deepEqual(wakes(effects).map(effect => effect.member), [coordinatorName]);
});

test('the wake limit pauses the swarm and is recorded once', () => {
  const setup = run(fresh({ maxMembers: 4, maxWakes: 1 }), join(a), post(a, 'x'), ended(a), post(coordinatorName, '@a one'));
  assert.equal(setup.swarm.wakes, 1);
  const { swarm, effects } = run(setup.swarm, post(a, 'y'), ended(a), post(coordinatorName, '@a two'), post(coordinatorName, '@a three'));
  assert.deepEqual(effects, []);
  assert.equal(kinds(swarm.entries).filter(kind => kind === 'exhausted').length, 1);
});

test('posts are refused when empty or from an unknown member', () => {
  assert.equal(refuse(fresh(), post(coordinatorName, '  ')), 'empty-text');
  assert.equal(refuse(fresh(), post(a, 'hi')), 'unknown-member');
});
