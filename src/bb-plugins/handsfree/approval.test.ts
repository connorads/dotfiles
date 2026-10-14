import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApprovals, type ApprovalPorts, type PendingApproval } from './approval.ts';

const command = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
  id: 'i1', status: 'pending',
  payload: { kind: 'approval', availableDecisions: ['allow_once', 'allow_for_session', 'deny'],
    subject: { kind: 'command', command: 'gh pr merge 15 --merge', sessionGrant: { network: { enabled: true }, fileSystem: null } } },
  ...overrides,
});

function setup(pending: unknown[]) {
  const resolved: unknown[] = [];
  const ports: ApprovalPorts = {
    list: async () => pending,
    resolve: async (threadId, interactionId, resolution) => { resolved.push({ threadId, interactionId, resolution }); },
  };
  return { approvals: makeApprovals(ports), resolved };
}

test('allow once resolves the single pending command without a session grant', async () => {
  const w = setup([command()]);
  const reply = await w.approvals.decide('t1', 'allow_once');
  assert.equal(reply.ok, true);
  assert.match(reply.message, /Allowed once: gh pr merge 15/);
  assert.deepEqual(w.resolved, [{ threadId: 't1', interactionId: 'i1', resolution: { decision: 'allow_once', grantedPermissions: null } }]);
});

test('allow for session passes the command session grant', async () => {
  const w = setup([command()]);
  await w.approvals.decide('t1', 'allow_for_session');
  assert.deepEqual(w.resolved, [{ threadId: 't1', interactionId: 'i1',
    resolution: { decision: 'allow_for_session', grantedPermissions: { network: { enabled: true }, fileSystem: null } } }]);
});

test('deny sends only the decision', async () => {
  const w = setup([command()]);
  assert.match((await w.approvals.decide('t1', 'deny')).message, /Denied/);
  assert.deepEqual(w.resolved, [{ threadId: 't1', interactionId: 'i1', resolution: { decision: 'deny' } }]);
});

test('permission grants pass the requested permissions', async () => {
  const w = setup([command({ payload: { kind: 'approval', availableDecisions: ['allow_once', 'deny'],
    subject: { kind: 'permission_grant', permissions: { network: { enabled: true }, fileSystem: { read: ['/a'], write: [] } } } } })]);
  await w.approvals.decide('t1', 'allow_once');
  assert.deepEqual(w.resolved, [{ threadId: 't1', interactionId: 'i1',
    resolution: { decision: 'allow_once', grantedPermissions: { network: { enabled: true }, fileSystem: { read: ['/a'], write: [] } } } }]);
});

test('no pending approval, several approvals, plans and unavailable decisions are rejected', async () => {
  const question = { id: 'q1', status: 'pending', payload: { kind: 'user_question' } };
  const cases: [unknown[], 'allow_once' | 'allow_for_session', RegExp][] = [
    [[question, command({ status: 'resolved' })], 'allow_once', /No approval is waiting/],
    [[command(), command({ id: 'i2' })], 'allow_once', /2 approvals are waiting/],
    [[command({ payload: { kind: 'approval', availableDecisions: ['allow_once', 'deny'], subject: { kind: 'plan' } } })], 'allow_once', /plan/],
    [[command({ payload: { kind: 'approval', availableDecisions: ['allow_once', 'deny'], subject: { kind: 'command', command: 'ls' } } })], 'allow_for_session', /not available/],
  ];
  for (const [pending, decision, message] of cases) {
    const w = setup(pending);
    const reply = await w.approvals.decide('t1', decision);
    assert.equal(reply.ok, false);
    assert.match(reply.message, message);
    assert.deepEqual(w.resolved, []);
  }
});
