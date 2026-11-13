import { z } from 'zod';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeArtifacts } from './artifacts.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectorService } from './service.ts';

function harness() {
  const calls: string[] = [];
  const service = new ConnectorService({
    run: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic', expiresAt: Date.now() + 3_600_000, scopes: ['user:mcp_servers'] } }),
    fetch: async () => Response.json({ data: [] }),
    listDir: async () => ['work'], now: Date.now, user: 'user', profilesRoot: '/profiles', claudePath: () => 'claude',
    artifacts: {
      tools: async (profile) => {
        calls.push(`tools:${profile}`);
        return [{ name: 'Artifact', inputSchema: { type: 'object' } }];
      },
      call: async ({ profile, tool, args }) => {
        calls.push(`call:${profile}:${tool}:${String(args.action)}`);
        return { content: [{ type: 'text', text: 'listed' }] };
      },
    },
  });
  return { service, calls };
}

test('artefacts appear alongside account connectors and expose native schemas', async () => {
  const { service } = harness();
  assert.deepEqual(await service.connectors('work'), [{ id: 'native-artifacts', name: 'Claude Code Artifacts' }]);
  const connector = await service.connector('work', 'Claude Code Artifacts');
  const tools = await service.toolViews({ profile: 'work', connector, overrides: {}, withSchema: true });
  assert.equal(tools[0]?.name, 'Artifact');
  assert.equal(tools[0]?.access, 'off');
  assert.deepEqual(tools[0]?.inputSchema, { type: 'object' });
});

test('artefact calls require permission and stay within the chosen profile', async () => {
  const { service, calls } = harness();
  const request = { profile: 'work', connector: 'Claude Code Artifacts', tool: 'Artifact', args: { action: 'list' } };
  await assert.rejects(service.call({ ...request, overrides: {} }), /turned off/);
  assert.ok(!calls.some(c => c.startsWith('call:')));
  assert.deepEqual(await service.call({ ...request, overrides: { 'claude code artifacts/Artifact': 'allow' } }),
    { content: [{ type: 'text', text: 'listed' }] });
  assert.ok(calls.includes('call:work:Artifact:list'));
  await assert.rejects(service.call({ ...request, tool: 'Bash', overrides: { 'claude code artifacts/Bash': 'allow' } }), /no tool/);
});


async function nativeFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'artifact-test-'));
  const executable = join(dir, 'native');
  await writeFile(executable, `#!${process.execPath}
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }));
  if (request.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [
    { name: 'Artifact', annotations: { readOnlyHint: true } }, { name: 'Bash' }
  ] } }));
  if (request.method === 'tools/call' && request.params.arguments.action !== 'hang')
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: String(process.pid) }] } }));
});
`, { mode: 0o700 });
  return new NativeArtifacts({ executable: () => executable, configDir: () => dir });
}

test('the native transport hides unrelated tools and closes the process after a call', async () => {
  const client = await nativeFixture();
  const tools = await client.tools('work');
  assert.deepEqual(tools.map(t => t.name), ['Artifact']);
  assert.equal(tools[0]?.annotations?.readOnlyHint, false);
  const result = await client.call({ profile: 'work', tool: 'Artifact', args: { action: 'list' } });
  const parsed = z.object({ content: z.array(z.object({ text: z.string() })) }).parse(result);
  const pid = Number(parsed.content[0]?.text);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(client.call({ profile: 'work', tool: 'Bash', args: {} }), /Only Claude Code/);
});

test('cancelling an artefact call stops a native process that does not reply', async () => {
  const client = await nativeFixture();
  await assert.rejects(client.call({ profile: 'work', tool: 'Artifact', args: { action: 'hang' }, signal: AbortSignal.timeout(200) }), /cancelled/);
});
