import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hibernateAll, refusal, summarise, workRefusal, type HibernatePorts, type ThreadFacts } from './hibernate.ts';
import type { Work } from './triage.ts';

const idle: ThreadFacts = { status: 'idle', runtimeStatus: 'idle', queuedMessageCount: 0, activeBackgroundAgentCount: 0, pendingInteractions: 0, archived: false };
const settle = { settleMs: 2000, pollMs: 500 };

test('only an idle thread with nothing pending may be stopped', () => {
  assert.equal(refusal(idle), null);
  assert.equal(refusal({ ...idle, status: 'active', runtimeStatus: 'active' }), 'active');
  assert.equal(refusal({ ...idle, runtimeStatus: 'waiting-for-host' }), 'waiting-for-host');
  assert.equal(refusal({ ...idle, pendingInteractions: 1 }), 'waiting for input');
  assert.equal(refusal({ ...idle, queuedMessageCount: 2 }), 'message queued');
  assert.equal(refusal({ ...idle, activeBackgroundAgentCount: 1 }), 'background agent running');
  assert.equal(refusal({ ...idle, archived: true }), 'archived');
});

test('the work refusal names the command and counts the rest', () => {
  assert.equal(workRefusal({ command: 'git commit -m wip', processes: 3 }), 'running git commit -m wip (+2 more processes)');
  assert.equal(workRefusal({ command: 'sleep 60', processes: 2 }), 'running sleep 60 (+1 more process)');
  assert.equal(workRefusal({ command: 'sleep 60', processes: 1 }), 'running sleep 60');
});

/**
 * A fake machine. Each thread has bb facts and a provider process, which may
 * own live work. A stop marks the process to exit after `exitAfterPolls` reads.
 */
function fakeMachine(threads: Record<string, ThreadFacts>, options: {
  exitAfterPolls?: Record<string, number>; work?: Record<string, string>; noProcess?: string[];
} = {}) {
  const stopped: string[] = [];
  const polls = new Map<string, number>();
  /** Undefined: no provider process. Null: a process with no live work. */
  const state = (threadId: string): Work | null | undefined => {
    if (options.noProcess?.includes(threadId)) return undefined;
    if (stopped.includes(threadId)) {
      const count = (polls.get(threadId) ?? 0) + 1;
      polls.set(threadId, count);
      if (count > (options.exitAfterPolls?.[threadId] ?? 0)) return undefined;
    }
    const command = options.work?.[threadId];
    return command ? { command, processes: 3 } : null;
  };
  const ports: HibernatePorts = {
    facts: async threadId => {
      const facts = threads[threadId];
      if (!facts) throw new Error(`Thread ${threadId} not found`);
      return facts;
    },
    processes: async threadIds => new Map(threadIds.flatMap(threadId => {
      const current = state(threadId);
      return current === undefined ? [] : [[threadId, current] as const];
    })),
    stop: async threadId => { stopped.push(threadId); },
    sleep: async () => {},
  };
  return { ports, stopped, polls };
}

test('every selected thread is attempted and each outcome reported', async () => {
  const { ports, stopped } = fakeMachine(
    { a: idle, b: { ...idle, status: 'active', runtimeStatus: 'active' }, c: idle },
    { exitAfterPolls: { a: 1, c: 99 } },
  );
  const outcomes = await hibernateAll(['a', 'b', 'c', 'missing', 'a'], ports, settle);
  assert.deepEqual(stopped, ['a', 'c']);
  assert.deepEqual(outcomes, [
    { threadId: 'a', outcome: 'hibernated' },
    { threadId: 'b', outcome: 'refused', reason: 'active' },
    { threadId: 'c', outcome: 'still-running' },
    { threadId: 'missing', outcome: 'failed', reason: 'Thread missing not found' },
  ]);
  assert.equal(summarise(outcomes), '1 hibernated, 1 stopped but still running, 1 refused, 1 failed');
});

test('an idle thread whose provider still runs a child is refused, naming the child, and never stopped', async () => {
  const { ports, stopped } = fakeMachine({ busy: idle, quiet: idle }, { work: { busy: 'git commit -m wip' } });
  const outcomes = await hibernateAll(['busy', 'quiet'], ports, settle);
  assert.deepEqual(stopped, ['quiet']);
  assert.deepEqual(outcomes[0], { threadId: 'busy', outcome: 'refused', reason: 'running git commit -m wip (+2 more processes)' });
});

test('bb state is read again after the process check, just before each stop', async () => {
  const order: string[] = [];
  const { ports } = fakeMachine({ a: idle, b: idle });
  await hibernateAll(['a', 'b'], {
    ...ports,
    facts: async id => { order.push(`facts ${id}`); return ports.facts(id); },
    processes: async ids => { order.push(`processes ${ids.join()}`); return ports.processes(ids); },
    stop: async id => { order.push(`stop ${id}`); return ports.stop(id); },
  }, { settleMs: 0, pollMs: 1 });
  assert.deepEqual(order.slice(0, 8), ['facts a', 'processes a', 'facts a', 'stop a', 'facts b', 'processes b', 'facts b', 'stop b']);
});

test('a message sent while the process table is read refuses the stop', async () => {
  const facts: Record<string, ThreadFacts> = { a: idle };
  const { ports, stopped } = fakeMachine(facts);
  const outcomes = await hibernateAll(['a'], {
    ...ports,
    processes: async ids => { facts.a = { ...idle, status: 'active', runtimeStatus: 'active' }; return ports.processes(ids); },
  }, settle);
  assert.deepEqual(stopped, []);
  assert.deepEqual(outcomes, [{ threadId: 'a', outcome: 'refused', reason: 'active' }]);
});

test('an unreadable machine refuses the stop rather than guessing', async () => {
  const { ports, stopped } = fakeMachine({ a: idle });
  const outcomes = await hibernateAll(['a'], { ...ports, processes: async () => { throw new Error('host offline'); } }, settle);
  assert.deepEqual(stopped, []);
  assert.deepEqual(outcomes, [{ threadId: 'a', outcome: 'refused', reason: "cannot read the machine's processes (host offline)" }]);
});

test('a thread with no provider process on the machine is refused: a stop would free nothing', async () => {
  const { ports, stopped } = fakeMachine({ codex: idle }, { noProcess: ['codex'] });
  const outcomes = await hibernateAll(['codex'], ports, settle);
  assert.deepEqual(stopped, []);
  assert.deepEqual(outcomes, [{ threadId: 'codex', outcome: 'refused', reason: 'no provider process on this machine' }]);
});

test('a stop that throws fails that thread only', async () => {
  const { ports } = fakeMachine({ a: idle, b: idle }, { exitAfterPolls: { b: 99 } });
  const outcomes = await hibernateAll(['a', 'b'], { ...ports, stop: async id => { if (id === 'a') throw new Error('machine offline'); } }, { settleMs: 0, pollMs: 1 });
  assert.deepEqual(outcomes.map(o => o.outcome), ['failed', 'still-running']);
});

test('slow exits share one settle window instead of one each', async () => {
  const { ports, polls } = fakeMachine({ a: idle, b: idle, c: idle }, { exitAfterPolls: { a: 99, b: 99, c: 99 } });
  let slept = 0;
  const outcomes = await hibernateAll(['a', 'b', 'c'], { ...ports, sleep: async ms => { slept += ms; } }, settle);
  assert.deepEqual(outcomes.map(o => o.outcome), ['still-running', 'still-running', 'still-running']);
  assert.equal(slept, 2000);
  assert.equal(polls.get('a'), 5);
});

test('a machine that goes unreadable during the settle leaves the stops reported as still running', async () => {
  const { ports } = fakeMachine({ a: idle });
  let reads = 0;
  const outcomes = await hibernateAll(['a'], {
    ...ports,
    processes: async ids => { if (++reads > 1) throw new Error('host offline'); return ports.processes(ids); },
  }, { settleMs: 0, pollMs: 1 });
  assert.deepEqual(outcomes, [{ threadId: 'a', outcome: 'still-running' }]);
});
