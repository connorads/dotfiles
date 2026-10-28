import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';
import { authOverrides } from './claude.ts';

const profile = { id: 'stretch', label: 'stretch', configDir: '/profiles/stretch' };

async function setup(launchEntries: { name: string; source: unknown; value: string }[]) {
  const thread = makeThreadResponse({ id: 't1', providerId: 'claude-code', status: 'idle', environmentId: 'e1' });
  const stops: unknown[] = [];
  const { bb, harness } = createFakePluginHost({ sdk: { threads: {
    get: async () => thread,
    stop: async (args: unknown) => { stops.push(args); return thread; },
    events: { list: async () => [{ type: 'provider.env-resolved', seq: 7, threadId: 't1', data: { entries: [...launchEntries, { name: 'ENABLE_CLAUDEAI_MCP_SERVERS', value: 'false', source: { plugin: 'claude-profiles' } }] } }] },
  }, environments: { get: async () => ({ id: 'e1', hostId: 'h1' }) } } as never });
  plugin(bb);
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile });
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  if (!hook) throw new Error('Missing dispatch hook.');
  const dispatch = (hostId = 'h1') => hook(makeMessageDispatchHookContext({
    thread: { id: 't1', providerId: 'claude-code', status: 'idle' }, host: { id: hostId } }));
  return { harness, thread, stops, dispatch };
}

test('a launch without the selected profile is stopped and the next send says why', async () => {
  const { harness, thread, stops, dispatch } = await setup([{ name: 'HOME', source: 'shell', value: '/Users/me' }]);
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 7 });
  assert.equal(stops.length, 1);
  const refused = await dispatch();
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /without the stretch account/);
  assert.deepEqual(await dispatch(), { action: 'proceed' });
  assert.equal(stops.length, 1);
});

test('a launch with the selected profile keeps running', async () => {
  const { harness, thread, stops, dispatch } = await setup([
    { name: 'CLAUDE_CONFIG_DIR', source: { plugin: 'claude-profiles' }, value: profile.configDir }]);
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 7 });
  assert.deepEqual(await dispatch(), { action: 'proceed' });
  assert.equal(stops.length, 0);
});

test('a send stops a bad launch that the event review has not seen yet', async () => {
  const { stops, dispatch } = await setup([]);
  assert.equal((await dispatch()).action, 'reject');
  assert.equal(stops.length, 1);
});

test('a send from another machine is refused before Claude starts on its native login', async () => {
  const { stops, dispatch } = await setup([
    { name: 'CLAUDE_CONFIG_DIR', source: { plugin: 'claude-profiles' }, value: profile.configDir }]);
  const refused = await dispatch('h2');
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /stretch account belongs to another machine/);
  assert.equal(stops.length, 0);
  assert.deepEqual(await dispatch('h1'), { action: 'proceed' });
});

async function usageSetup() {
  const thread = makeThreadResponse({ id: 't1', providerId: 'claude-code', status: 'idle', environmentId: 'e1' });
  const hostCalls: { method: string; input: unknown; hostId: string }[] = [];
  const quota = { status: 'ok', message: null, observedAt: Date.now(), windows: [
    { id: 'five_hour', label: 'Five hours', usedPercent: 12, resetsAt: null, cost: null },
    { id: 'seven_day', label: 'Seven days', usedPercent: 64, resetsAt: null, cost: null }] };
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async () => thread },
      environments: { get: async () => ({ id: 'e1', hostId: 'h1' }) },
      hosts: { list: async () => [{ id: 'h1', status: 'connected' }] },
      providers: { list: async () => [{ id: 'claude-code', displayName: 'Claude Code' }] },
      plugins: { callRpc: async (args: { pluginId: string }) => { throw new Error(`Unexpected RPC to ${args.pluginId}`); } },
    } as never,
    experimental_callHostRpc: call => {
      hostCalls.push(call);
      if (call.method === 'profiles') return [{ id: 'default', label: 'Default', configDir: null }, profile];
      if (call.method === 'usage') return quota;
      throw new Error(`Unexpected host call ${call.method}`);
    },
  });
  plugin(bb);
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile });
  return { harness, hostCalls };
}

test('the usage header for a bound thread shows that profile\'s quota without calling another plugin', async () => {
  const { harness, hostCalls } = await usageSetup();
  assert.deepEqual(await harness.behavior.callRpc('usage.header', { threadId: 't1' }), {
    providerId: 'claude-code', label: 'Claude Code', accountLabel: 'stretch', message: null, windows: [
      { label: '5-hour', period: 'five-hour', usedPercent: 12, resetsAt: null, cost: null },
      { label: 'Weekly', period: 'week', usedPercent: 64, resetsAt: null, cost: null }] });
  assert.deepEqual(hostCalls.filter(call => call.method === 'usage').map(call => [call.hostId, (call.input as { profileId: string }).profileId]),
    [['h1', 'stretch']]);
});

test('the header and the usage RPC share one quota reading per minute', async () => {
  const { harness, hostCalls } = await usageSetup();
  await harness.behavior.callRpc('usage.header', { threadId: 't1' });
  await harness.behavior.callRpc('usage', { threadId: 't1', profileId: 'stretch', refresh: false });
  await harness.behavior.callRpc('usage.header', { threadId: 't1' });
  assert.equal(hostCalls.filter(call => call.method === 'usage').length, 1);
});

test('the header CLI prints a thread\'s usage', async () => {
  const { harness } = await usageSetup();
  const result = await harness.behavior.runCli(['header', 't1']);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).accountLabel, 'stretch');
  assert.equal((await harness.behavior.runCli(['overview', '--bogus'])).exitCode, 1);
});

const work = { id: 'work', label: 'Work', configDir: '/profiles/work' };
const personal = { id: 'personal', label: 'Personal', configDir: '/profiles/personal' };
type ThreadFields = { parentThreadId?: string | null; originKind?: 'fork' | null; sourceThreadId?: string | null; lifecycleOwnerThreadId?: string | null;
  originPluginId?: string | null };

async function newThreadSetup(hostProfiles = [{ id: 'default', label: 'Default', configDir: null }, work, personal],
  stage: (input: unknown) => unknown = () => ({ link: '/link', target: '/target' })) {
  const hostCalls: { method: string; input: unknown; hostId: string }[] = [];
  const identities: Record<string, string> = { source: 'session-source' };
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, providerId: threadId.startsWith('codex') ? 'codex' : 'claude-code' }),
        events: { list: async ({ threadId, types }: { threadId: string; types: string[] }) =>
        types.includes('thread/identity') && identities[threadId]
          ? [{ type: 'thread/identity', seq: 1, threadId, data: { providerThreadId: identities[threadId] } }] : [] } },
      hosts: { list: async () => [{ id: 'h1', status: 'connected' }, { id: 'h2', status: 'disconnected' }] },
    } as never,
    experimental_callHostRpc: call => {
      hostCalls.push(call);
      if (call.method === 'profiles') return hostProfiles;
      if (call.method === 'stageFork') return stage(call.input);
      if (call.method === 'unstageFork') return { removed: true, forked: true };
      if (call.method === 'sweepForkStages') return { removed: [] };
      throw new Error(`Unexpected host call ${call.method}`);
    },
  });
  plugin(bb);
  await bb.storage.kv.set('next-thread-profile', 'personal');
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  if (!hook) throw new Error('Missing dispatch hook.');
  const firstSend = ({ parentThreadId = null, ...thread }: ThreadFields = {}, hostId: string | null = 'h1') => hook(makeMessageDispatchHookContext({
    thread: { id: 'child', providerId: 'claude-code', status: 'pending', parentThreadId, ...thread },
    host: hostId ? { id: hostId } : null, parentThreadId }));
  const binding = () => bb.storage.kv.get<{ hostId: string; profile: { id: string } }>('thread:child');
  const calls = (method: string) => hostCalls.filter(call => call.method === method).map(call => [call.hostId, call.input]);
  return { bb, harness, firstSend, binding, identities, calls };
}

test('a child of a thread on a named account starts on that account, not the composer account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h2', profile: work });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.deepEqual(await binding(), { hostId: 'h1', profile: work });
});

test('a first send that claims an account tells open views, so the sidebar badges the new thread', async () => {
  const { firstSend, harness } = await newThreadSetup();
  await firstSend();
  assert.deepEqual(harness.inspection.realtimeSignals.map(signal => [signal.channel, signal.payload]),
    [['profiles-changed', { threadId: 'child' }]]);
});

test('thread accounts list named bindings and omit Default', async () => {
  const { bb, harness } = createFakePluginHost();
  plugin(bb);
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: work });
  await bb.storage.kv.set('thread:t2', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  await bb.storage.kv.set('next-thread-profile', 'personal');
  assert.deepEqual(await harness.behavior.callRpc('threadAccounts', {}), [{ threadId: 't1', profileId: 'work', label: 'Work' }]);
});

test('a fork starts on its source thread\'s account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: work });
  assert.deepEqual(await firstSend({ originKind: 'fork', sourceThreadId: 'source' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'work');
});

test('a child of a thread switched to Default starts on Default, not the composer account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.deepEqual(await binding(), { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
});

test('a fork of a thread switched to Default starts on Default', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  assert.deepEqual(await firstSend({ originKind: 'fork', sourceThreadId: 'source' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'default');
});

test('an inherited account missing on this machine refuses the send and binds nothing', async () => {
  const { bb, firstSend, binding } = await newThreadSetup([{ id: 'default', label: 'Default', configDir: null }, personal]);
  await bb.storage.kv.set('thread:parent', { hostId: 'h2', profile: work });
  const refused = await firstSend({ parentThreadId: 'parent' });
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /inherits the Work account.*does not exist on this machine/);
  assert.equal(await binding(), undefined);
});

test('a child of an unbound thread uses the composer account', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a thread with no parent uses the composer account', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend(), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a lifecycle owner alone is not a parent', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:owner', { hostId: 'h1', profile: work });
  await firstSend({ lifecycleOwnerThreadId: 'owner' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a workflow worker starts on its origin thread\'s account, not the composer account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:owner', { hostId: 'h1', profile: work });
  assert.deepEqual(await firstSend({ lifecycleOwnerThreadId: 'owner', originPluginId: 'workflows' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'work');
});

test('a workflow worker of an unbound Claude thread starts on Default, not the composer account', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend({ lifecycleOwnerThreadId: 'owner', originPluginId: 'workflows' }), { action: 'proceed' });
  assert.equal(await binding(), undefined);
});

test('a workflow worker of a non-Claude thread uses the composer account', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend({ lifecycleOwnerThreadId: 'codex-owner', originPluginId: 'workflows' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a child that already has an account keeps it', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h1', profile: work });
  await bb.storage.kv.set('thread:child', { hostId: 'h1', profile: personal });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a fork of an unbound thread stays on Default, where BB wrote its session', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend({ originKind: 'fork', sourceThreadId: 'source' }), { action: 'proceed' });
  assert.equal(await binding(), undefined);
});

test('a fork on a named account stages its source session where BB looks for it', async () => {
  const { bb, firstSend, calls } = await newThreadSetup();
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: work });
  assert.deepEqual(await firstSend({ originKind: 'fork', sourceThreadId: 'source' }), { action: 'proceed' });
  assert.deepEqual(calls('stageFork'), [['h1',
    { root: '~/.claude-profiles/code', profileId: 'work', sessionId: 'session-source', forkThreadId: 'child' }]]);
  assert.equal((await bb.storage.kv.get<{ hostId: string }>('stage:child'))?.hostId, 'h1');
});

test('a fork whose source session cannot be staged is refused before BB forks it', async () => {
  const { bb, firstSend } = await newThreadSetup(undefined, () => { throw new Error('Source session x was not found in this account.'); });
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: work });
  const refused = await firstSend({ originKind: 'fork', sourceThreadId: 'source' });
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /Could not prepare this fork on the Work account: Source session x was not found/);
  assert.equal(await bb.storage.kv.get('stage:child'), undefined);
});

test('forks on Default and children that are not forks stage nothing', async () => {
  const { bb, firstSend, calls } = await newThreadSetup();
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  await firstSend({ originKind: 'fork', sourceThreadId: 'source' });
  const other = await newThreadSetup();
  await other.bb.storage.kv.set('thread:parent', { hostId: 'h1', profile: work });
  await other.firstSend({ parentThreadId: 'parent' });
  assert.deepEqual([...calls('stageFork'), ...other.calls('stageFork')], []);
});

test('a fork\'s stage is removed once its session exists, with a check that it landed in the account', async () => {
  const { bb, harness, identities, calls } = await newThreadSetup();
  await bb.storage.kv.set('stage:child', { hostId: 'h1', stagedAt: Date.now() });
  const thread = makeThreadResponse({ id: 'child', providerId: 'claude-code', status: 'starting' });
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 1 });
  assert.deepEqual(calls('unstageFork'), []);
  identities.child = 'session-fork';
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 2 });
  assert.deepEqual(calls('unstageFork'), [['h1', { forkThreadId: 'child', forkSessionId: 'session-fork' }]]);
  assert.equal(await bb.storage.kv.get('stage:child'), undefined);
});

test('a fork that failed before it had a session still loses its stage', async () => {
  const { bb, harness, calls } = await newThreadSetup();
  await bb.storage.kv.set('stage:child', { hostId: 'h1', stagedAt: Date.now() });
  const thread = makeThreadResponse({ id: 'child', providerId: 'claude-code', status: 'error' });
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 1 });
  assert.deepEqual(calls('unstageFork'), [['h1', { forkThreadId: 'child', forkSessionId: null }]]);
});

test('the stage sweep clears old links on connected machines and forgets expired stages', async () => {
  const { bb, harness, calls } = await newThreadSetup();
  await bb.storage.kv.set('stage:old', { hostId: 'h2', stagedAt: Date.now() - 60 * 60_000 });
  await bb.storage.kv.set('stage:new', { hostId: 'h1', stagedAt: Date.now() });
  await harness.behavior.runSchedule('fork-stage-sweep');
  assert.deepEqual(calls('sweepForkStages'), [['h1', { maxAgeMs: 10 * 60_000 }]]);
  assert.deepEqual(await bb.storage.kv.list('stage:'), ['stage:new']);
});

test('a child of a thread on Default needs no machine to start', async () => {
  const { bb, firstSend } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }, null), { action: 'proceed' });
});

test('a new-thread draft reads an account\'s quota on this machine through the shared cache', async () => {
  const { harness, hostCalls } = await usageSetup();
  const quota = await harness.behavior.callRpc('nextThreadQuota', { profileId: 'stretch' });
  assert.equal((quota as { status: string }).status, 'ok');
  await harness.behavior.callRpc('usage', { threadId: 't1', profileId: 'stretch', refresh: false });
  assert.deepEqual(hostCalls.filter(call => call.method === 'usage').map(call => call.hostId), ['h1']);
});


function loginFixture() {
  const created: { scope: unknown; start?: { mode: string; argv?: string[] } }[] = [];
  const closed: unknown[] = [];
  let exited = false;
  const terminal = () => ({ id: 'terminal-login', status: exited ? 'exited' : 'running' });
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: { list: async () => [{ id: 'remote', name: 'Remote', status: 'connected' }] },
      terminals: {
        create: async (args: typeof created[number]) => { created.push(args); exited = false; return terminal(); },
        get: async () => terminal(),
        close: async (args: unknown) => { closed.push(args); exited = true; return { ok: true }; },
      },
    } as never,
    experimental_callHostRpc: async ({ method, hostId }) => {
      assert.equal(hostId, 'remote');
      assert.equal(method, 'profiles');
      return [{ id: 'default', label: 'Default', configDir: null },
        { id: 'work', label: 'Work', configDir: "/profiles/work's account" }];
    },
  });
  plugin(bb);
  return { harness, created, closed, exit: () => { exited = true; } };
}
const loginAccount = (profile: string) => `claude-profiles:${JSON.stringify(['remote', '~/.claude-profiles/code', profile])}`;

test('usage login starts on the account host, isolates its profile, and reuses an active terminal', async t => {
  const { harness, created, exit } = loginFixture();
  t.after(() => harness.lifecycle.dispose());
  const input = { hostId: 'remote', accountId: loginAccount('work') };
  const results = await Promise.all([harness.behavior.callRpc('usage.login', input), harness.behavior.callRpc('usage.login', input)]);
  assert.deepEqual(results, [{ terminalId: 'terminal-login' }, { terminalId: 'terminal-login' }]);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.scope, { kind: 'host_path', hostId: 'remote', cwd: null });
  assert.equal(created[0]?.start?.mode, 'argv');
  assert.ok(created[0]?.start?.argv?.includes("CLAUDE_CONFIG_DIR=/profiles/work's account"));
  assert.deepEqual(created[0]?.start?.argv?.slice(-3), ['claude', 'auth', 'login']);
  for (const name of authOverrides) assert.ok(created[0]?.start?.argv?.includes(name));
  exit();
  await harness.behavior.callRpc('usage.login', input);
  assert.equal(created.length, 2);
});

test('native Default login clears profile overrides and uses the host home directory', async t => {
  const { harness, created } = loginFixture();
  t.after(() => harness.lifecycle.dispose());
  await harness.behavior.callRpc('usage.login', { hostId: 'remote', accountId: 'provider-claude-code:["remote","claude-code"]' });
  assert.deepEqual(created[0]?.scope, { kind: 'host_path', hostId: 'remote', cwd: null });
  assert.ok(created[0]?.start?.argv?.includes('CLAUDE_CONFIG_DIR'));
  assert.ok(!created[0]?.start?.argv?.some(value => value.startsWith('CLAUDE_CONFIG_DIR=')));
});

test('Codex login defaults to a device code on the account host and reuses an active terminal', async t => {
  const { harness, created, closed } = loginFixture();
  t.after(() => harness.lifecycle.dispose());
  const input = { hostId: 'remote', accountId: 'provider-codex:["remote","codex"]' };
  await harness.behavior.callRpc('usage.login', input);
  await harness.behavior.callRpc('usage.login', { ...input, method: 'device' });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.scope, { kind: 'host_path', hostId: 'remote', cwd: null });
  assert.deepEqual(created[0]?.start?.argv, ['codex', 'login', '--device-auth']);
  assert.deepEqual(closed, []);
});

test('OpenCode login opens on the account host and reuses its active terminal', async t => {
  const { harness, created } = loginFixture();
  t.after(() => harness.lifecycle.dispose());
  const input = { hostId: 'remote', accountId: 'provider-opencode:["remote","opencode"]' };
  await harness.behavior.callRpc('usage.login', input);
  await harness.behavior.callRpc('usage.login', input);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.scope, { kind: 'host_path', hostId: 'remote', cwd: null });
  assert.deepEqual(created[0]?.start?.argv, ['opencode', 'auth', 'login']);
});

test('switching Codex sign-in method closes the running login before starting the other', async t => {
  const { harness, created, closed } = loginFixture();
  t.after(() => harness.lifecycle.dispose());
  const input = { hostId: 'remote', accountId: 'provider-codex:["remote","codex"]' };
  await harness.behavior.callRpc('usage.login', input);
  await harness.behavior.callRpc('usage.login', { ...input, method: 'browser' });
  assert.deepEqual(closed, [{ terminalId: 'terminal-login', mode: 'force' }]);
  assert.deepEqual(created.map(value => value.start?.argv), [['codex', 'login', '--device-auth'], ['codex', 'login']]);
});

test('login rejects stale profiles, another host, and unrelated usage sources before opening a terminal', async t => {
  const { harness, created } = loginFixture();
  t.after(() => harness.lifecycle.dispose());
  for (const [hostId, accountId] of [
    ['offline', loginAccount('work')], ['remote', loginAccount('missing')],
    ['remote', 'claude-profiles:["other","~/.claude-profiles/code","work"]'],
    ['remote', 'claude-profiles:["remote","/old-root","work"]'],
    ['remote', 'provider-codex:["other","codex"]'], ['offline', 'provider-codex:["offline","codex"]'],
    ['remote', 'provider-opencode:["other","opencode"]'], ['offline', 'provider-opencode:["offline","opencode"]'],
    ['remote', 'provider-opencode:["remote","codex"]'],
    ['remote', 'provider-grok:["remote","grok"]'],
  ]) await assert.rejects(harness.behavior.callRpc('usage.login', { hostId, accountId }));
  assert.equal(created.length, 0);
});

test('the next CLI reads and sets the account new threads start on', async () => {
  const { bb, harness, firstSend, binding } = await newThreadSetup();
  const read = await harness.behavior.runCli(['next']);
  assert.equal(read.exitCode, 0);
  assert.deepEqual(JSON.parse(read.stdout), { currentId: 'personal', profiles: ['default', 'work', 'personal'] });
  assert.deepEqual(JSON.parse((await harness.behavior.runCli(['next', 'work'])).stdout).currentId, 'work');
  assert.equal(await bb.storage.kv.get('next-thread-profile'), 'work');
  await firstSend();
  assert.equal((await binding())?.profile.id, 'work');
  const missing = await harness.behavior.runCli(['next', 'nobody']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr ?? '', /Profile does not exist/);
  assert.equal(await bb.storage.kv.get('next-thread-profile'), 'work');
});
