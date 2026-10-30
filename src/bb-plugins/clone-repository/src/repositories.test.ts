import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRepository } from './repositories.ts';
import { listRepositories } from './discovery.ts';

test('accepts GitHub shorthand and clone URLs as one canonical identity', () => {
  for (const value of ['Acme/Atlas', 'https://github.com/Acme/Atlas.git', 'https://github.com/Acme/Atlas/', 'git@github.com:Acme/Atlas.git', 'ssh://git@github.com/Acme/Atlas.git']) {
    assert.equal(parseRepository(value), 'acme/atlas');
  }
});

test('rejects arguments, other hosts and path traversal', () => {
  for (const value of ['-x/atlas', 'acme/..', 'acme/.', '../atlas', 'acme/atlas/extra', 'https://example.com/acme/atlas', 'https://github.com/acme/foo/../atlas', 'https://github.com/acme/%2e%2e/atlas', 'https://user:pass@github.com/acme/atlas', 'https://github.com/acme/atlas?x=1', 'git@github.com:acme/atlas;touch x']) {
    assert.equal(parseRepository(value), null, value);
  }
});

test('lists exactly one page and distinguishes failures from an empty list', async () => {
  const calls: string[][] = [];
  const result = await listRepositories(2, async (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: JSON.stringify([{ fullName: 'acme/atlas', description: '', visibility: 'private' }]), stderr: '' };
  });
  assert.deepEqual(result, { ok: true, repositories: [{ fullName: 'acme/atlas', description: '', visibility: 'private' }], hasMore: false });
  assert.ok(calls[0]?.includes('page=2'));
  assert.ok(!calls[0]?.includes('--paginate'));
  assert.equal((await listRepositories(1, async () => ({ code: 1, stdout: '', stderr: 'Authentication required' }))).ok, false);
  assert.equal((await listRepositories(1, async () => ({ code: 0, stdout: '{bad', stderr: '' }))).ok, false);
});
