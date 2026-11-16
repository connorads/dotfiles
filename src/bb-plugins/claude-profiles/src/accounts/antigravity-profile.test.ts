import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, lstat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAntigravityProfile, antigravityLaunch } from './antigravity-profile.ts';

test('an isolated launch refuses absent profiles instead of using the default login', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agy-account-'));
  await assert.rejects(antigravityLaunch(home, 'secondary', '/bin/agy'), /Create this profile/);
});
test('profile creation is private and the launcher preserves workspace and excludes default credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agy-account-'));
  const profile = await prepareAntigravityProfile(home, 'secondary');
  assert.equal((await lstat(profile)).mode & 0o777, 0o700);
  const launch = await antigravityLaunch(home, 'secondary', '/bin/agy');
  assert.equal(launch.env.HOME, join(profile, 'home'));
  assert.equal(launch.env.WSL_INTEROP, '1');
  assert.equal(launch.env.GOOGLE_API_KEY, undefined);
  assert.equal(launch.command, '/usr/bin/sandbox-exec');
  const policy = await readFile(launch.args[1]!, 'utf8');
  assert.match(policy, /com\.apple\.securityd/);
  assert.match(policy, /\/usr\/bin\/security/);
  assert.ok(policy.includes(join(home, '.gemini')));
  assert.equal(launch.args.at(-1), '/bin/agy');
});
test('account names cannot escape their root or impersonate Default', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agy-account-'));
  for (const id of ['../other', 'default', 'UPPER', '', 'a/b'])
    await assert.rejects(prepareAntigravityProfile(home, id));
});
