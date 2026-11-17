import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inScope, ownerOf, resolveChoice } from './choice.ts';
import { parseRpcBody } from './mcp.ts';
import { decide } from './policy.ts';
import { ConnectorService, UserFacingError, type Run } from './service.ts';
import { keychainService, parseToken } from './token.ts';

test('a chat pick beats the project default, which beats the global default', () => {
  assert.deepEqual(resolveChoice('work', 'client', 'home'), { profile: 'work', source: 'thread', readOnly: false, only: null });
  assert.deepEqual(resolveChoice(undefined, 'client', 'home'), { profile: 'client', source: 'project', readOnly: false, only: null });
  assert.deepEqual(resolveChoice(undefined, undefined, 'home'), { profile: 'home', source: 'default', readOnly: false, only: null });
  assert.deepEqual(resolveChoice('off', 'client', 'home'), { profile: null, source: 'thread', readOnly: false, only: null });
  assert.deepEqual(resolveChoice(undefined, undefined, undefined), { profile: null, source: 'default', readOnly: false, only: null });
});

test('a started thread gets its owner\'s access read-only, ahead of the project default', () => {
  const owner = { resolved: resolveChoice('work', undefined, undefined), share: true };
  assert.deepEqual(resolveChoice(undefined, 'client', 'home', { owner }), { profile: 'work', source: 'owner', readOnly: true, only: null });
  const ownerOff = { resolved: resolveChoice('off', undefined, undefined), share: true };
  assert.deepEqual(resolveChoice(undefined, 'client', 'home', { owner: ownerOff }), { profile: null, source: 'owner', readOnly: true, only: null });
  assert.deepEqual(resolveChoice('client', undefined, undefined, { owner }), { profile: 'client', source: 'thread', readOnly: false, only: null });
});

test('a started thread gets its owner\'s connector list, and nothing from an owner that does not share', () => {
  const resolved = resolveChoice('work', undefined, undefined, { only: ['Slack'] });
  assert.deepEqual(resolved.only, ['Slack']);
  assert.deepEqual(resolveChoice(undefined, undefined, undefined, { only: ['HubSpot'], owner: { resolved, share: true } }),
    { profile: 'work', source: 'owner', readOnly: true, only: ['Slack'] });
  assert.equal(resolveChoice(undefined, 'client', 'home', { owner: { resolved, share: false } }).profile, null);
  assert.equal(inScope(null, 'Slack'), true);
  assert.equal(inScope(['slack'], 'Slack'), true);
  assert.equal(inScope(['Slack'], 'HubSpot'), false);
  assert.equal(inScope([], 'Slack'), false);
});

test('the owner is the parent, else the origin of a BB workflow run', () => {
  const none = { parentThreadId: null, originPluginId: null, lifecycleOwnerThreadId: null };
  assert.equal(ownerOf(none), null);
  assert.equal(ownerOf({ ...none, parentThreadId: 'thr_parent' }), 'thr_parent');
  assert.equal(ownerOf({ ...none, originPluginId: 'workflows', lifecycleOwnerThreadId: 'thr_origin' }), 'thr_origin');
  assert.equal(ownerOf({ ...none, originPluginId: 'other', lifecycleOwnerThreadId: 'thr_origin' }), null);
});

test('read-only tools are allowed and writes stay off until allowed', () => {
  const read = { name: 'read_channel', annotations: { readOnlyHint: true } };
  const write = { name: 'send_message' };
  assert.deepEqual(decide('Slack', read, {}, false), { access: 'allow' });
  assert.deepEqual(decide('Slack', write, {}, false), { access: 'off', reason: 'policy' });
  assert.deepEqual(decide('Slack', write, { 'slack/send_message': 'allow' }, false), { access: 'allow' });
  assert.deepEqual(decide('Slack', read, { 'slack/read_channel': 'off' }, false), { access: 'off', reason: 'policy' });
  assert.deepEqual(decide('Slack', write, { 'slack/send_message': 'allow' }, true), { access: 'off', reason: 'read-only-thread' });
  assert.deepEqual(decide('Slack', read, {}, true), { access: 'allow' });
});

test('a call goes through exactly when the tool list shows it allowed', async () => {
  const tools = [{ name: 'read_channel', annotations: { readOnlyHint: true } }, { name: 'send_message' }];
  const { service, calls } = harness([item(9_000_000)], { 'tools/list': { tools }, 'tools/call': { content: [] } });
  const connector = await service.connector('work', 'Slack');
  for (const readOnly of [false, true])
    for (const tool of tools)
      for (const override of [undefined, 'allow', 'off'] as const) {
        const overrides = override ? { [`slack/${tool.name}`]: override } : {};
        const shown = (await service.toolViews({ profile: 'work', connector, overrides, readOnly, withSchema: false }))
          .find(v => v.name === tool.name)!.access;
        const before = calls.length;
        const reached = await service.call({ profile: 'work', connector: 'Slack', tool: tool.name, args: {}, overrides, readOnly })
          .then(() => true, (e: unknown) => { assert.ok(e instanceof UserFacingError); return false; });
        const label = `${tool.name} readOnly=${readOnly} override=${override}`;
        assert.equal(reached, shown === 'allow', label);
        assert.equal(calls.slice(before).includes('fetch /v1/mcp/srv_1 tools/call'), reached, label);
      }
});

test('the Keychain service matches Claude Code for a profile directory', () => {
  assert.match(keychainService('/home/someone/profiles/work'), /^Claude Code-credentials-[0-9a-f]{8}$/);
  assert.notEqual(keychainService('/a'), keychainService('/b'));
});

test('a malformed Keychain item fails without echoing it', () => {
  assert.throws(() => parseToken('secret-value'), (e: Error) => !e.message.includes('secret-value'));
});

test('SSE and JSON replies both yield the matching message', () => {
  assert.deepEqual(parseRpcBody('{"id":1,"result":{}}', 1), { id: 1, result: {} });
  assert.deepEqual(parseRpcBody('event: message\ndata: {"id":2,"result":{"ok":true}}\n\n', 2), { id: 2, result: { ok: true } });
});

const item = (expiresAt: number, scopes = ['user:mcp_servers']) =>
  JSON.stringify({ claudeAiOauth: { accessToken: `tok-${expiresAt}`, expiresAt, scopes } });

function harness(keychain: string[], replies: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const run: Run = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file === '/usr/bin/security') return keychain.shift() ?? keychain.at(-1)!;
    return '';
  };
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) as { method: string; id?: number } : null;
    calls.push(`fetch ${String(url).replace(/^https:\/\/[^/]+/, '')} ${body?.method ?? 'GET'}`);
    if (String(url).includes('/v1/mcp_servers')) return Response.json({ data: [{ id: 'srv_1', display_name: 'Slack' }] });
    const result = body ? replies[body.method] ?? {} : {};
    return Response.json({ jsonrpc: '2.0', id: body?.id, result }, { headers: { 'mcp-session-id': 's1' } });
  }) as typeof fetch;
  const service = new ConnectorService({
    run, fetch: fetchFn, now: () => 1_000_000, user: 'me', profilesRoot: '/profiles',
    listDir: async () => ['work', '.hidden'], claudePath: () => 'claude',
  });
  return { service, calls };
}

test('an expiring login is renewed through the Claude Code binary, then re-read', async () => {
  const { service, calls } = harness([item(1_000_000 + 60_000), item(1_000_000 + 3_600_000)]);
  assert.equal(await service.token('work'), `tok-${1_000_000 + 3_600_000}`);
  assert.ok(calls.includes('claude mcp list'));
});

test('a login without connector scope is refused with guidance', async () => {
  const { service } = harness([item(9_000_000, ['user:inference'])]);
  await assert.rejects(service.token('work'), (e: Error) => e instanceof UserFacingError && /setup-token/.test(e.message));
});

test('a write tool is refused until allowed, then called through the proxy', async () => {
  const { service, calls } = harness([item(9_000_000)], {
    'tools/list': { tools: [{ name: 'send_message' }] },
    'tools/call': { content: [{ type: 'text', text: 'sent' }] },
  });
  await assert.rejects(service.call({ profile: 'work', connector: 'slack', tool: 'send_message', args: {}, overrides: {}, readOnly: false }), /turned off/);
  assert.deepEqual(await service.call({ profile: 'work', connector: 'Slack', tool: 'send_message', args: { text: 'hi' }, overrides: { 'slack/send_message': 'allow' }, readOnly: false }),
    { content: [{ type: 'text', text: 'sent' }] });
  assert.ok(calls.includes('fetch /v1/mcp/srv_1 tools/call'));
  const sent = calls.filter(c => c === 'fetch /v1/mcp/srv_1 tools/call').length;
  await assert.rejects(service.call({ profile: 'work', connector: 'Slack', tool: 'send_message', args: { text: 'hi' }, overrides: { 'slack/send_message': 'allow' }, readOnly: true }),
    /read-only access from the thread that started it/);
  assert.equal(calls.filter(c => c === 'fetch /v1/mcp/srv_1 tools/call').length, sent);
  assert.deepEqual(await service.profiles(), ['work']);
});
