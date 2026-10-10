import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { makeOpenLazygit } from './open.ts';

type Terminals = BbPluginApi['sdk']['terminals'];
type Session = Awaited<ReturnType<Terminals['create']>>;
const session = (id: string, status: Session['status'] = 'running'): Session => ({
  id, status, threadId: 'thread', environmentId: 'env', hostId: 'host',
  title: 'Lazygit', initialCwd: '/checkout', cols: 120, rows: 40,
  exitCode: null, closeReason: null, createdAt: 0, updatedAt: 0, lastUserInputAt: null,
});

test('reuses an active lazygit session without launching another process', async () => {
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('existing')] }),
    create: async () => { throw new Error('must reuse'); },
  });
  assert.equal(await open('thread'), 'existing');
});

test('replaces an exited session and launches in the requested thread', async () => {
  let calls = 0;
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('old', 'exited')] }),
    create: async (args) => {
      calls++;
      assert.deepEqual(args.scope, { kind: 'thread', threadId: 'thread' });
      assert.equal(args.start?.mode, 'command');
      return session('new');
    },
  });
  assert.equal(await open('thread'), 'new');
  assert.equal(calls, 1);
});

test('simultaneous opens share one launch', async () => {
  let calls = 0;
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [] }),
    create: async () => { calls++; return session('new'); },
  });
  assert.deepEqual(await Promise.all([open('thread'), open('thread')]), ['new', 'new']);
  assert.equal(calls, 1);
});

test('a failed launch can be retried', async () => {
  let calls = 0;
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [] }),
    create: async () => {
      if (++calls === 1) throw new Error('host unavailable');
      return session('new');
    },
  });
  await assert.rejects(open('thread'), /host unavailable/);
  assert.equal(await open('thread'), 'new');
});
