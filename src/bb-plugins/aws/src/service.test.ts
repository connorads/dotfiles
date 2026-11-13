import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Broker, MAX_REPORTED_LIFETIME_MS, type RunGranted } from './broker.ts';
import { AwsService, type Kv } from './service.ts';

const NOW = Date.parse('2026-11-13T12:00:00Z');

function memoryKv(): Kv {
  const rows = new Map<string, unknown>();
  return { get: async <T>(key: string) => rows.get(key) as T | undefined, set: async (key, value) => { rows.set(key, value); } };
}

/** A fake Granted: profiles in `signedOut` need --auto-login, others mint. */
function fakeGranted(signedOut = new Set<string>(), now = () => NOW) {
  const calls: string[][] = [];
  const run: RunGranted = async args => {
    calls.push(args);
    const profile = args[args.indexOf('--profile') + 1]!;
    if (signedOut.has(profile) && !args.includes('--auto-login')) {
      return { code: 1, stdout: '', stderr: '\u001b[0;31m[✘] error when retrieving credentials from custom process. please login using \'granted sso login\' or set --auto-login' };
    }
    signedOut.delete(profile);
    if (profile === 'static') return { code: 0, stderr: '', stdout: JSON.stringify({ Version: 1, AccessKeyId: 'AKIASTATIC', SecretAccessKey: 'secret' }) };
    return { code: 0, stderr: '', stdout: JSON.stringify({
      Version: 1, AccessKeyId: `ASIA${profile.toUpperCase()}`, SecretAccessKey: 'secret', SessionToken: 'session',
      Expiration: new Date(now() + 60 * 60_000).toISOString(),
    }) };
  };
  return { run, calls };
}

function setup(signedOut?: Set<string>, now = () => NOW) {
  const granted = fakeGranted(signedOut, now);
  const regions = new Map<string, string | null>();
  const service = new AwsService({
    kv: memoryKv(),
    broker: new Broker(granted.run, now),
    profiles: async () => [{ name: 'dev', region: 'eu-west-1' }, { name: 'prod/ReadOnly', region: null }, { name: 'static', region: null }],
    writeRegion: async (threadId, region) => { regions.set(threadId, region); },
    now,
  });
  return { service, granted, regions };
}

test('a thread with no profile gets 404 and no Granted call', async () => {
  const { service, granted } = setup();
  const token = await service.token('t1');
  const served = await service.serve('t1', token);
  assert.equal(served.status, 404);
  assert.equal(granted.calls.length, 0);
});

test('only the thread token reads that thread', async () => {
  const { service } = setup();
  const t1 = await service.token('t1');
  const t2 = await service.token('t2');
  await service.setChoice('t1', { profile: 'dev', region: null });
  assert.equal((await service.serve('t1', t2)).status, 403);
  assert.equal((await service.serve('t1', null)).status, 401);
  assert.equal((await service.serve('t1', t1)).status, 200);
  assert.equal(await service.token('t1'), t1, 'token is stable');
});

test('serves the selected profile, caps the lifetime and caches the mint', async () => {
  const { service, granted } = setup();
  const token = await service.token('t1');
  await service.setChoice('t1', { profile: 'dev', region: null });
  const first = await service.serve('t1', token);
  const second = await service.serve('t1', `Bearer ${token}`);
  assert.equal(first.status, 200);
  assert.deepEqual(second, first);
  if (first.status !== 200) return;
  assert.equal(first.body.AccessKeyId, 'ASIADEV');
  assert.equal(first.body.Expiration, new Date(NOW + MAX_REPORTED_LIFETIME_MS).toISOString());
  assert.equal(granted.calls.length, 1);
  assert.ok(!granted.calls[0]!.includes('--auto-login'), 'a mint never opens a browser');
});

test('switching profile mid-thread changes the next answer', async () => {
  const { service } = setup();
  const token = await service.token('t1');
  await service.setChoice('t1', { profile: 'dev', region: null });
  await service.serve('t1', token);
  await service.setChoice('t1', { profile: 'prod/ReadOnly', region: null });
  const served = await service.serve('t1', token);
  assert.equal(served.status === 200 && served.body.AccessKeyId, 'ASIAPROD/READONLY');
});

test('an expired sign-in returns 503 until the person signs in from BB', async () => {
  const { service, granted } = setup(new Set(['dev']));
  const token = await service.token('t1');
  await service.setChoice('t1', { profile: 'dev', region: null });
  const blocked = await service.serve('t1', token);
  assert.equal(blocked.status, 503);
  assert.match(blocked.status === 503 ? blocked.body.message : '', /Do not sign in to AWS yourself/);
  assert.ok(service.signInNeeded.has('dev'));
  assert.deepEqual(await service.signIn('dev'), { ok: true });
  assert.ok(granted.calls.at(-1)!.includes('--auto-login'));
  assert.ok(!service.signInNeeded.has('dev'));
  assert.equal((await service.serve('t1', token)).status, 200);
});

test('region comes from the override, else the profile', async () => {
  const { service, regions } = setup();
  await service.setChoice('t1', { profile: 'dev', region: null });
  assert.equal(regions.get('t1'), 'eu-west-1');
  await service.setChoice('t1', { profile: 'dev', region: 'us-east-1' });
  assert.equal(regions.get('t1'), 'us-east-1');
  await service.setChoice('t1', { profile: null, region: null });
  assert.equal(regions.get('t1'), null);
});

test('rejects unknown profiles and malformed regions', async () => {
  const { service } = setup();
  await assert.rejects(service.setChoice('t1', { profile: 'nope', region: null }), /No AWS profile/);
  await assert.rejects(service.setChoice('t1', { profile: 'dev', region: 'eu-west-1\n[profile x]' }), /not an AWS region/);
});

test('the AWS CLI reads credentials from the endpoint with the thread token', async () => {
  // The CLI checks expiry against the real clock.
  const { service } = setup(undefined, Date.now);
  const token = await service.token('t1');
  await service.setChoice('t1', { profile: 'dev', region: null });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const served = await service.serve(url.searchParams.get('thread'), req.headers.authorization ?? null);
    res.writeHead(served.status, { 'content-type': 'application/json' }).end(JSON.stringify(served.body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const { stdout } = await promisify(execFile)('aws', ['configure', 'export-credentials', '--format', 'process'], {
      env: {
        PATH: process.env['PATH'], HOME: process.env['HOME'],
        AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_EC2_METADATA_DISABLED: 'true',
        AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${port}/creds?thread=t1`,
        AWS_CONTAINER_AUTHORIZATION_TOKEN: token,
      },
    });
    assert.equal(JSON.parse(stdout).AccessKeyId, 'ASIADEV');
  } finally {
    server.close();
  }
});

test('choosing a profile mints it before the agent asks', async () => {
  const { service, granted } = setup();
  await service.setChoice('t1', { profile: 'dev', region: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(granted.calls.length, 1);
  await service.serve('t1', await service.token('t1'));
  assert.equal(granted.calls.length, 1, 'the request uses the warmed credentials');
});

test('a failure is repeated without running Granted again, with colour codes removed', async () => {
  const { service, granted } = setup(new Set(['dev']));
  const token = await service.token('t1');
  await service.setChoice('t1', { profile: 'dev', region: null });
  await service.serve('t1', token);
  await service.serve('t1', token);
  assert.equal(granted.calls.length, 1);
  assert.ok(!(service.signInNeeded.get('dev') ?? '').includes('\u001b'));
});

test('refuses long-lived IAM user keys', async () => {
  const { service } = setup();
  const token = await service.token('t1');
  await service.setChoice('t1', { profile: 'static', region: null });
  const served = await service.serve('t1', token);
  assert.equal(served.status, 502);
  assert.match(served.status === 502 ? served.body.message : '', /long-lived IAM user keys/);
  assert.doesNotMatch(JSON.stringify(served.body), /AKIA/);
});
