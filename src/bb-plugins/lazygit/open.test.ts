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

test('selected checkouts launch separately and pass paths as literal argv', async () => {
  const created: Parameters<Terminals['create']>[0][] = [];
  const root = "/trees/review ' $(touch nope)";
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('default')] }),
    create: async args => { created.push(args); return { ...session('selected'), title: args.title ?? '' }; },
  });
  assert.equal(await open('thread', root), 'selected');
  assert.equal(created[0]?.title, `Lazygit: ${root}`);
  assert.deepEqual(created[0]?.start, {
    mode: 'argv', argv: ['zsh', '-ic', 'cd -- "$1" && if [[ "$PWD" == "$HOME" ]]; then lgdf; else lazygit; fi', 'lazygit', root],
  });
  assert.deepEqual(created[0]?.scope, { kind: 'thread', threadId: 'thread' });
});

test('reopening a selected checkout reuses only its own terminal', async () => {
  const root = '/trees/review';
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('default'), { ...session('selected'), title: `Lazygit: ${root}` }] }),
    create: async () => { throw new Error('must reuse'); },
  });
  assert.equal(await open('thread', root), 'selected');
});

test('simultaneous opens for different checkouts do not share a launch', async () => {
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [] }),
    create: async args => session(args.title ?? ''),
  });
  assert.deepEqual(await Promise.all([open('thread', '/a'), open('thread', '/b')]), ['Lazygit: /a', 'Lazygit: /b']);
});
