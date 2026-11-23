import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanBoardPreview,
  formatRelativeTime,
  groupWorkerSteps,
  parseTimestampMs,
} from './format.ts';
import {
  antigravityAppDataRoot,
  extractMentions,
  isAntigravityProvider,
  loadSwarmSnapshot,
  loadWorkerLog,
  swarmFingerprint,
} from './swarm.ts';

async function setupFixture() {
  const home = await mkdtemp(join(tmpdir(), 'agy-swarm-test-'));
  const coordId = '7de8a129-f9b0-40c5-8d9d-f4851aeb94ed';
  const workerAId = '56c1efad-3fe0-4ed8-8917-0f98fe913563';
  const workerBId = '11111111-2222-3333-4444-555555555555';
  const appData = join(home, '.gemini', 'antigravity-cli');
  const swarmDir = join(appData, 'brain', coordId, '.system_generated', 'swarm');
  await mkdir(swarmDir, { recursive: true });
  await mkdir(join(appData, 'brain', coordId, '.system_generated', 'logs'), { recursive: true });
  await mkdir(join(appData, 'brain', workerAId, '.system_generated', 'logs'), { recursive: true });
  await mkdir(join(appData, 'brain', workerBId, '.system_generated', 'logs'), { recursive: true });

  await writeFile(join(swarmDir, 'swarm.json'), JSON.stringify({
    version: 1, backend: 'local', swarm_id: coordId, created_at: '2026-11-23T17:38:41Z',
  }));
  await writeFile(join(swarmDir, 'members.json'), JSON.stringify({
    title: 'Parser rewrite',
    members: {
      coordinator: {
        conversation_id: coordId, role: 'coordinator', applied_model: 'gemini-4-neon-high',
        workspace_mode: 'inherit', wake_mode: 'mentions', last_read_seq: 2, killed: false,
      },
      parser: {
        conversation_id: workerAId, role: 'worker', applied_model: 'gemini-4-neon-high',
        workspace_mode: 'share', wake_mode: 'mentions', last_read_seq: 2, killed: false,
      },
      verifier: {
        conversation_id: workerBId, role: 'worker', applied_model: 'gemini-3.8-flash-high',
        workspace_mode: 'inherit', wake_mode: 'mentions', last_read_seq: 1, killed: false,
      },
    },
  }));
  await writeFile(join(swarmDir, 'plan.json'), JSON.stringify({
    goal: { title: 'Rewrite parser cleanly', line: 'Implement parser and verify with tests.' },
    tasks: { parser: 'Fix edge cases', verifier: 'Run test suite' },
    threads: [{ id: 't-parse', title: 'Parser', goal: 'All parser tests pass', tasks: ['parser', 'verifier'] }],
  }));
  await writeFile(join(swarmDir, 'board.jsonl'), [
    JSON.stringify({ seq: 1, agent: 'coordinator', text: '@parser Fix parser edge cases', time: '2026-11-23 17:38:41', kind: 'brief' }),
    JSON.stringify({ seq: 2, agent: 'parser', text: '@verifier [done] Parser fixed, please verify', time: '2026-11-23 17:39:02', channel: 'parser' }),
  ].join('\n') + '\n');

  // parser finished and parked in swarm_wait
  await writeFile(join(appData, 'brain', workerAId, '.system_generated', 'logs', 'transcript.jsonl'), [
    JSON.stringify({ step_index: 0, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-23T17:39:00Z', model: 'gemini-4-neon-high', tool_calls: [{ name: 'post_message', args: { text: '@verifier [done] Parser fixed' } }, { name: 'swarm_wait', args: { since: 1 } }] }),
    JSON.stringify({ step_index: 1, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-23T17:39:02Z', content: 'Created At: 2026-11-23T17:39:02Z\nCompleted At: 2026-11-23T17:39:02Z\n{"status":"posted","seq":2}' }),
    JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-23T17:39:02Z', content: 'Waiting for @mentions.' }),
  ].join('\n') + '\n');

  // verifier is actively running a shell command
  await writeFile(join(appData, 'brain', workerBId, '.system_generated', 'logs', 'transcript.jsonl'), [
    JSON.stringify({ step_index: 0, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-23T17:39:05Z', model: 'gemini-3.8-flash-high', tool_calls: [{ name: 'run_command', args: { CommandLine: 'pnpm test' } }] }),
  ].join('\n') + '\n');

  return { home, coordId, workerAId, workerBId, swarmDir };
}

test('resolves Default and isolated Antigravity appData roots and rejects invalid providers', () => {
  assert.equal(isAntigravityProvider('acp-antigravity'), true);
  assert.equal(isAntigravityProvider('acp-antigravity-profile-secondary'), true);
  assert.equal(isAntigravityProvider('acp-antigravity-profile-default'), false);
  assert.equal(isAntigravityProvider('acp-antigravity-profile-../escape'), false);
  assert.equal(isAntigravityProvider('claude-code'), false);

  assert.equal(antigravityAppDataRoot('/Users/test', 'acp-antigravity'), '/Users/test/.gemini/antigravity-cli');
  assert.equal(
    antigravityAppDataRoot('/Users/test', 'acp-antigravity-profile-secondary'),
    '/Users/test/.local/share/agy-profiles/secondary/home/.gemini/antigravity-cli',
  );
  assert.equal(antigravityAppDataRoot('/Users/test', 'codex'), null);
});

test('extractMentions normalises unique @mentions', () => {
  assert.deepEqual(extractMentions('@Parser check @verifier and @parser + @all'), ['parser', 'verifier', 'all']);
});

test('loads full swarm snapshot with derived worker states, plan, board, and channels', async () => {
  const { home, coordId } = await setupFixture();
  try {
    const snap = await loadSwarmSnapshot(home, 'acp-antigravity', coordId);
    assert.equal(snap.kind, 'swarm');
    if (snap.kind !== 'swarm') assert.fail('expected swarm');

    assert.equal(snap.title, 'Parser rewrite');
    assert.equal(snap.boardHead, 2);
    assert.deepEqual(snap.channels, ['main', 'parser']);
    assert.equal(snap.plan?.goalTitle, 'Rewrite parser cleanly');
    assert.equal(snap.summary.totalWorkers, 2);
    assert.equal(snap.summary.doneWorkers, 1);
    assert.equal(snap.summary.workingWorkers, 1);
    assert.equal(snap.summary.blockedWorkers, 0);
    assert.equal(snap.summary.killedWorkers, 0);
    assert.equal(snap.summary.status, 'working');
    assert.equal(snap.summary.lastActivityAt, '2026-11-23T17:39:05Z');
    assert.equal(snap.summary.active, true);

    const parser = snap.members.find(m => m.name === 'parser');
    const verifier = snap.members.find(m => m.name === 'verifier');
    assert.equal(parser?.state, 'done');
    assert.equal(parser?.workspaceMode, 'share');
    assert.equal(verifier?.state, 'working');
    assert.equal(verifier?.activity, 'Running run_command');
    assert.equal(verifier?.unreadCount, 1);

    assert.equal(snap.messages[1]?.isDone, true);
    assert.deepEqual(snap.messages[1]?.mentions, ['verifier']);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('derives blocked worker state and stopped swarm status instead of false green done', async () => {
  const { home, coordId, workerAId, workerBId, swarmDir } = await setupFixture();
  try {
    // Make parser blocked (posted "Blocked ..." and parked) and verifier killed.
    await writeFile(join(swarmDir, 'members.json'), JSON.stringify({
      title: 'Sandbox build',
      members: {
        coordinator: {
          conversation_id: coordId, role: 'coordinator', applied_model: 'gemini-4-neon-high',
          workspace_mode: 'inherit', wake_mode: 'mentions', last_read_seq: 3, killed: false,
        },
        parser: {
          conversation_id: workerAId, role: 'worker', applied_model: 'gemini-4-neon-high',
          workspace_mode: 'share', wake_mode: 'mentions', last_read_seq: 3, killed: false,
        },
        verifier: {
          conversation_id: workerBId, role: 'worker', applied_model: 'gemini-3.8-flash-high',
          workspace_mode: 'inherit', wake_mode: 'mentions', last_read_seq: 1, killed: true,
        },
      },
    }));
    await writeFile(join(swarmDir, 'board.jsonl'), [
      JSON.stringify({ seq: 1, agent: 'coordinator', text: '@parser Build sandbox', time: '2026-11-23 17:38:41', kind: 'brief' }),
      JSON.stringify({ seq: 2, agent: 'parser', text: '@coordinator Blocked: all `write_file` calls timed out', time: '2026-11-23 17:40:00' }),
    ].join('\n') + '\n');

    const blockedSnap = await loadSwarmSnapshot(home, 'acp-antigravity', coordId);
    assert.equal(blockedSnap.kind, 'swarm');
    if (blockedSnap.kind !== 'swarm') assert.fail('expected swarm');
    assert.equal(blockedSnap.members.find(m => m.name === 'parser')?.state, 'blocked');
    assert.equal(blockedSnap.members.find(m => m.name === 'verifier')?.state, 'killed');
    assert.equal(blockedSnap.summary.blockedWorkers, 1);
    assert.equal(blockedSnap.summary.killedWorkers, 1);
    assert.equal(blockedSnap.summary.status, 'blocked');

    // Kill both workers (aborted swarm) -> status must be 'stopped', not 'done'.
    await writeFile(join(swarmDir, 'members.json'), JSON.stringify({
      title: 'Sandbox build',
      members: {
        coordinator: {
          conversation_id: coordId, role: 'coordinator', applied_model: 'gemini-4-neon-high',
          workspace_mode: 'inherit', wake_mode: 'mentions', last_read_seq: 3, killed: false,
        },
        parser: {
          conversation_id: workerAId, role: 'worker', applied_model: 'gemini-4-neon-high',
          workspace_mode: 'share', wake_mode: 'mentions', last_read_seq: 3, killed: true,
        },
        verifier: {
          conversation_id: workerBId, role: 'worker', applied_model: 'gemini-3.8-flash-high',
          workspace_mode: 'inherit', wake_mode: 'mentions', last_read_seq: 1, killed: true,
        },
      },
    }));
    const stoppedSnap = await loadSwarmSnapshot(home, 'acp-antigravity', coordId);
    assert.equal(stoppedSnap.kind, 'swarm');
    if (stoppedSnap.kind !== 'swarm') assert.fail('expected swarm');
    assert.equal(stoppedSnap.summary.doneWorkers, 0);
    assert.equal(stoppedSnap.summary.killedWorkers, 2);
    assert.equal(stoppedSnap.summary.status, 'stopped');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('loads worker transcript log, strips boilerplate timestamps, and pairs tool outputs with planner calls', async () => {
  const { home, coordId } = await setupFixture();
  try {
    const log = await loadWorkerLog(home, 'acp-antigravity', coordId, 'parser');
    assert.equal(log.ok, true);
    if (!log.ok) assert.fail('expected ok');
    assert.equal(log.totalSteps, 3);
    assert.equal(log.steps[1]?.text, '{"status":"posted","seq":2}');

    const grouped = groupWorkerSteps(log.steps, false);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]?.toolCalls.length, 2);
    assert.equal(grouped[0]?.toolCalls[0]?.name, 'post_message');
    assert.equal(grouped[0]?.toolCalls[0]?.result?.text, '{"status":"posted","seq":2}');
    assert.equal(grouped[0]?.toolCalls[1]?.name, 'swarm_wait');
    assert.equal(grouped[0]?.toolCalls[1]?.result?.text, 'Waiting for @mentions.');

    const missing = await loadWorkerLog(home, 'acp-antigravity', coordId, 'ghost');
    assert.equal(missing.ok, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('cleanBoardPreview and timestamp formatting helpers handle UTC board dates and markdown', () => {
  assert.equal(
    cleanBoardPreview('@coordinator [stall] Blocked on `write_file` in workspace'),
    'Blocked on write_file in workspace',
  );
  const base = parseTimestampMs('2026-11-23 17:39:00');
  assert.equal(base, Date.parse('2026-11-23T17:39:00Z'));
  assert.equal(formatRelativeTime('2026-11-23 17:39:00', base! + 5_000), 'just now');
  assert.equal(formatRelativeTime('2026-11-23 17:39:00', base! + 42_000), '42s ago');
  assert.equal(formatRelativeTime('2026-11-23 17:39:00', base! + 5 * 60_000), '5m ago');
  assert.equal(formatRelativeTime('2026-11-23 17:39:00', base! + 3 * 3600_000), '3h ago');
});

test('fingerprint changes when board.jsonl updates and returns null when no swarm exists', async () => {
  const { home, coordId, swarmDir } = await setupFixture();
  try {
    assert.equal(await swarmFingerprint(home, 'acp-antigravity', '00000000-0000-0000-0000-000000000000'), null);
    const before = await swarmFingerprint(home, 'acp-antigravity', coordId);
    assert.ok(before);
    await writeFile(join(swarmDir, 'board.jsonl'), '{"seq":1,"agent":"coordinator","text":"updated"}\n');
    const after = await swarmFingerprint(home, 'acp-antigravity', coordId);
    assert.notEqual(before, after);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
