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

  const wake = quiet.effects[0]!;
  assert.deepEqual(wake.type === 'wake' && wake.also.map(entry => entry.seq), [2]);

  const again = run(quiet.swarm, ended(coordinatorName));
  assert.deepEqual(again.effects, []);
  assert.equal(again.swarm.entries.length, quiet.swarm.entries.length);
});

test('no stall is declared when the coordinator has seen every post', () => {
  const { swarm, effects } = run(fresh(), join(a), ended(coordinatorName), post(a, '@coordinator done'), post(coordinatorName, 'noted'), ended(a), ended(coordinatorName));
  assert.deepEqual(effects, []);
  assert.deepEqual(kinds(swarm.entries), ['joined', 'post', 'post']);
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

test('a wake also gives the coordinator the posts that did not mention it', () => {
  const setup = run(fresh(), join(a), join(b), ended(coordinatorName), post(a, 'a note for nobody'));
  assert.deepEqual(setup.effects, []);
  const { swarm, effects } = run(setup.swarm, post(b, '@coordinator done'));
  const wake = effects[0]!;
  assert.deepEqual(wake.type === 'wake' && [wake.entries.map(entry => entry.seq), wake.also.map(entry => entry.seq)], [[4], [3]]);

  // The note reached the coordinator, so a quiet board is not a stall.
  const quiet = run(swarm, ended(a), ended(b), ended(coordinatorName));
  assert.deepEqual(quiet.effects, []);
  assert.deepEqual(kinds(quiet.swarm.entries), ['joined', 'joined', 'post', 'post']);
});

test('a worker is woken with its mentions only', () => {
  const { effects } = run(fresh(), join(a), join(b), post(a, 'x'), ended(a), post(b, 'a note for nobody'), post(coordinatorName, '@a go'));
  const wake = effects[0]!;
  assert.deepEqual(wake.type === 'wake' && [wake.entries.map(entry => entry.seq), wake.also], [[5], []]);
});

test('a later silent turn is recorded without a wake and reaches the coordinator when everyone is idle', () => {
  const setup = run(fresh(), join(a), join(b), post(a, '@coordinator first result'), ended(a), post(coordinatorName, '@a try again'), ended(coordinatorName), ended(coordinatorName));
  const silent = run(setup.swarm, ended(a, 'second result'));
  const reply = silent.swarm.entries.at(-1)!;
  assert.deepEqual(reply.kind === 'reply' && [reply.text, reply.turn], ['second result', 'later']);
  assert.deepEqual(silent.effects, []);

  const idle = run(silent.swarm, post(b, 'done'), ended(b));
  const wake = idle.effects[0]!;
  assert.equal(wake.type === 'wake' && wake.member, coordinatorName);
  assert.deepEqual(wake.type === 'wake' && wake.also.map(entry => entry.kind), ['reply', 'post']);
});

test('a later silent turn with no reply leaves no entry', () => {
  const setup = run(fresh(), join(a), post(a, '@coordinator done'), ended(a), post(coordinatorName, '@a thanks'));
  const { swarm, effects } = run(setup.swarm, ended(a, '  '));
  assert.deepEqual(kinds(swarm.entries), ['joined', 'post', 'post']);
  assert.deepEqual(effects, []);
});

const failed = (name: MemberName): Step => ({ type: 'turnFailed', member: name, error: 'quota' });

test('a failed member is retried by its own mention, not by @all or by mentions from before it failed', () => {
  const setup = run(fresh(), join(a), join(b), post(coordinatorName, '@a one more thing'), failed(a));
  assert.deepEqual(setup.effects, []);

  const broadcast = run(setup.swarm, post(coordinatorName, '@all status please'));
  assert.deepEqual(wakes(broadcast.effects), []);

  const retry = run(broadcast.swarm, post(coordinatorName, '@a try again'));
  const wake = retry.effects[0]!;
  assert.deepEqual(wake.type === 'wake' && [wake.member, wake.entries.map(entry => entry.seq)], [a, [6]]);
  assert.equal(member(retry.swarm, a).run, 'working');
});

test('close also stops a failed worker', () => {
  const { effects } = run(fresh(), join(a), failed(a), { type: 'close', by: coordinatorName, summary: 'done' });
  assert.deepEqual(effects, [{ type: 'stop', member: a, threadId: thread('a') }]);
});

test('a failed coordinator that is retried also gets the reports it missed', () => {
  const setup = run(fresh(), join(a), join(b), failed(coordinatorName), ended(a, 'result from a'));
  assert.deepEqual(setup.effects, []);
  const { effects } = run(setup.swarm, post(b, '@coordinator are you there?'));
  const wake = effects[0]!;
  assert.deepEqual(wake.type === 'wake' && [wake.entries.map(entry => entry.kind), wake.also.map(entry => entry.kind)], [['post'], ['reply']]);
});

test('at the wake limit the coordinator gets one last wake that says so', () => {
  const setup = run(fresh({ maxMembers: 4, maxWakes: 1 }), join(a), post(a, 'x'), ended(a), post(coordinatorName, '@a one'), post(a, 'y'), ended(a));
  const blocked = run(setup.swarm, post(coordinatorName, '@a two'));
  assert.deepEqual(blocked.effects, []);

  const last = run(blocked.swarm, ended(coordinatorName));
  const wake = last.effects[0]!;
  assert.deepEqual(wake.type === 'wake' && [wake.member, wake.entries.map(entry => entry.kind)], [coordinatorName, ['exhausted']]);

  const after = run(last.swarm, post(coordinatorName, '@a three'), ended(coordinatorName), post('human', 'carry on'));
  assert.deepEqual(after.effects, []);
  assert.equal(kinds(after.swarm.entries).filter(kind => kind === 'exhausted').length, 1);
});

test('an idle coordinator is told at once when the limit blocks a wake', () => {
  const setup = run(fresh({ maxMembers: 4, maxWakes: 1 }), join(a), join(b), post(a, 'x'), ended(a), post(b, '@a help'), ended(coordinatorName));
  assert.equal(setup.swarm.wakes, 1);
  // b's turn ends with a mention waiting for it, which the limit blocks.
  const { effects } = run(setup.swarm, post(a, '@b here'), ended(a), ended(b));
  assert.deepEqual(wakes(effects).map(effect => effect.member), [coordinatorName]);
});

test('a long relayed reply is cut and points to the worker\'s thread', () => {
  const { swarm } = run(fresh(), join(a), ended(a, 'x'.repeat(2000)));
  const reply = swarm.entries.at(-1)!;
  const text = reply.kind === 'reply' ? reply.text : '';
  assert.equal(text.startsWith('x'.repeat(600)), true);
  assert.match(text, /^x{600} \[cut; the full reply is in a's thread\]$/);
});

test('a mention inside code wakes nobody', () => {
  const setup = run(fresh(), join(a), post(a, 'x'), ended(a));
  const quoted = run(setup.swarm, post(coordinatorName, 'the brief said `@a go` and\n```\n@a again\n```'));
  assert.deepEqual(quoted.effects, []);
  const plain = run(quoted.swarm, post(coordinatorName, 'now @a go'));
  assert.equal(wakes(plain.effects).length, 1);
});
