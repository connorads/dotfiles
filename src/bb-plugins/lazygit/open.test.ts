import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { makeOpenLazygit, composerTarget } from './open.ts';

type Terminals = BbPluginApi['sdk']['terminals'];
type Session = Awaited<ReturnType<Terminals['create']>>;
type Project = Awaited<ReturnType<BbPluginApi['sdk']['projects']['get']>>;
const session = (id: string, status: Session['status'] = 'running', at: Partial<Session> = {}): Session => ({
  id, status, threadId: 'thread', environmentId: 'env', hostId: 'host',
  title: 'Lazygit', initialCwd: '/checkout', cols: 120, rows: 40,
  exitCode: null, closeReason: null, createdAt: 0, updatedAt: 0, lastUserInputAt: null, ...at,
});
const source = (path: string, isDefault: boolean) => ({
  id: path, projectId: 'project', type: 'local_path' as const, hostId: 'host', path, isDefault, createdAt: 0, updatedAt: 0,
});
const project = (sources: Project['sources']): Project => ({
  id: 'project', kind: 'standard', name: 'Project', gitRemoteUrl: null, sources, createdAt: 0, updatedAt: 0,
});
const noProjects = { get: async (): Promise<Project> => { throw new Error('no project lookup expected'); } };
const thread = { kind: 'thread', threadId: 'thread' } as const;

test('reuses an active lazygit session without launching another process', async () => {
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('existing')] }),
    create: async () => { throw new Error('must reuse'); },
  }, noProjects);
  assert.equal(await open(thread), 'existing');
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
  }, noProjects);
  assert.equal(await open(thread), 'new');
  assert.equal(calls, 1);
});

test('without a thread, launches in the project default checkout like the New thread terminal', async () => {
  const open = makeOpenLazygit({
    list: async (args) => {
      assert.deepEqual(args.scope, { kind: 'host_path', hostId: 'host', cwd: '/default' });
      // A thread's terminal on the same path is not the New thread screen's to show.
      return { sessions: [session('thread-owned', 'running', { initialCwd: '/default', environmentId: null })] };
    },
    create: async (args) => {
      assert.deepEqual(args.scope, { kind: 'host_path', hostId: 'host', cwd: '/default' });
      return session('new', 'running', { threadId: null, environmentId: null, initialCwd: '/default' });
    },
  }, { get: async () => project([source('/other', false), source('/default', true)]) });
  assert.equal(await open({ kind: 'project', projectId: 'project' }), 'new');
});

test('without a thread, reuses the project checkout lazygit', async () => {
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('existing', 'running', { threadId: null, environmentId: null, initialCwd: '/default' })] }),
    create: async () => { throw new Error('must reuse'); },
  }, { get: async () => project([source('/default', true)]) });
  assert.equal(await open({ kind: 'project', projectId: 'project' }), 'existing');
});

test('a reused environment launches in that environment, not in a thread of it', async () => {
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [session('thread-owned')] }),
    create: async (args) => {
      assert.deepEqual(args.scope, { kind: 'environment', environmentId: 'env' });
      return session('new', 'running', { threadId: null });
    },
  }, noProjects);
  assert.equal(await open({ kind: 'environment', environmentId: 'env' }), 'new');
});

test('a composer targets its thread, else the reused environment or project its New thread picks', () => {
  const scope = { kind: 'new-thread', projectId: 'project' } as const;
  assert.deepEqual(composerTarget(scope, { environment: { type: 'reuse', environmentId: 'env' } }), { kind: 'environment', environmentId: 'env' });
  assert.deepEqual(composerTarget(scope, { environment: { type: 'project-default' } }), { kind: 'project', projectId: 'project' });
  assert.deepEqual(composerTarget(scope, null), { kind: 'project', projectId: 'project' });
  assert.equal(composerTarget({ kind: 'new-thread', projectId: null }, null), null);
  assert.deepEqual(composerTarget({ kind: 'thread', threadId: 'thread' }, null), thread);
  assert.equal(composerTarget({ kind: 'queued-message', threadId: 'thread', queuedMessageId: 'q' }, null), null);
});

test('a project with no checkout reports why', async () => {
  const open = makeOpenLazygit({
    list: async () => { throw new Error('must not list'); },
    create: async () => { throw new Error('must not create'); },
  }, { get: async () => project([]) });
  await assert.rejects(open({ kind: 'project', projectId: 'project' }), /no local checkout/);
});

test('simultaneous opens share one launch', async () => {
  let calls = 0;
  const open = makeOpenLazygit({
    list: async () => ({ sessions: [] }),
    create: async () => { calls++; return session('new'); },
  }, noProjects);
  assert.deepEqual(await Promise.all([open(thread), open(thread)]), ['new', 'new']);
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
  }, noProjects);
  await assert.rejects(open(thread), /host unavailable/);
  assert.equal(await open(thread), 'new');
});
