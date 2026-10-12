import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Proc } from './parse.ts';
import { appLimit, liveWork, providerTrees, terminateRefusal, threadWork, triage } from './triage.ts';

const bridge = '/Applications/bb.app/Contents/MacOS/bb /x/host-daemon/dist/bb-provider-bridge-worker.mjs /Users/me';
const claude = '/u/claude --output-format stream-json';
const procs: Proc[] = [
  { pid: 10, ppid: 1, command: '/Applications/bb.app/Contents/MacOS/bb /x/host-daemon/dist/daemon-bundle.mjs' },
  { pid: 20, ppid: 10, command: bridge },
  { pid: 21, ppid: 20, command: claude },
  { pid: 22, ppid: 21, command: 'node /u/mcp-server.js' },
  { pid: 23, ppid: 20, command: claude },
  // A thread terminal: same variable, but hung off the daemon, and a stop leaves it running.
  { pid: 30, ppid: 10, command: '/bin/zsh -l' },
  { pid: 40, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  { pid: 41, ppid: 40, command: '/Applications/Google Chrome.app/Contents/Frameworks/H.app/Contents/MacOS/Google Chrome Helper' },
];
const threadIds = new Map([[21, 'thr_a'], [22, 'thr_a'], [23, 'thr_b'], [30, 'thr_a']]);

test('provider trees start at the bridge child and include its descendants', () => {
  assert.deepEqual(providerTrees(procs, threadIds), [
    { threadId: 'thr_a', rootPid: 21, pids: [21, 22] },
    { threadId: 'thr_b', rootPid: 23, pids: [23] },
  ]);
});

test('apps group by bundle and rank by footprint; threads rank by tree footprint', () => {
  const trees = providerTrees(procs, threadIds);
  const footprints = new Map([[21, 1200], [22, 100], [23, 300], [40, 900], [41, 700]]);
  const result = triage(procs, trees, footprints);
  assert.deepEqual(result.apps.map(app => [app.app, app.mb, app.count]), [['Google Chrome', 1600, 2], ['claude', 1500, 2], ['node', 100, 1]]);
  assert.deepEqual(result.apps[0]!.processes.map(proc => proc.pid), [40, 41]);
  assert.deepEqual(result.apps[1]!.processes.map(proc => [proc.pid, proc.owner]), [[21, 'thread'], [23, 'thread']]);
  assert.equal(result.apps[0]!.processes[0]!.owner, null);
  assert.deepEqual(result.threads.map(({ threadId, mb, processes }) => [threadId, mb, processes]), [['thr_a', 1300, 2], ['thr_b', 300, 1]]);
});

test('bb\'s own processes are marked so the dialog offers no End the host would refuse', () => {
  const result = triage(procs, providerTrees(procs, threadIds), new Map([[10, 700], [20, 90], [40, 900]]));
  const owners = new Map(result.apps.flatMap(app => app.processes.map(proc => [proc.pid, proc.owner])));
  assert.deepEqual([owners.get(10), owners.get(20), owners.get(40)], ['bb', 'bb', null]);
});

test('a process with a small RSS but a large footprint still ranks first', () => {
  // The sample is every process top reports, so nothing is pre-filtered by RSS.
  const nix: Proc = { pid: 50, ppid: 1, command: 'nix eval --json .#checks' };
  const result = triage([...procs, nix], [], new Map([[50, 2961], [40, 800]]));
  assert.deepEqual(result.apps.map(app => app.app), ['nix', 'Google Chrome']);
});

test('the app list is capped for the dialog', () => {
  const many: Proc[] = Array.from({ length: appLimit + 5 }, (_, i) => ({ pid: 100 + i, ppid: 1, command: `/bin/app${i}` }));
  const result = triage(many, [], new Map(many.map(proc => [proc.pid, proc.pid])));
  assert.equal(result.apps.length, appLimit);
  assert.equal(result.apps[0]!.app, `app${appLimit + 4}`);
});

test('processes without a footprint reading are left out of the app list', () => {
  const result = triage(procs, [], new Map([[40, 800]]));
  assert.deepEqual(result.apps.map(app => app.app), ['Google Chrome']);
});

/** The tree seen live: an idle thread whose claude still ran a commit hook's nix eval. */
const commit: Proc[] = [
  { pid: 20, ppid: 10, command: bridge },
  { pid: 97326, ppid: 20, command: claude },
  { pid: 21026, ppid: 97326, command: "/bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot.sh && eval 'git commit -m wip'" },
  { pid: 21027, ppid: 21026, command: 'git commit -m wip' },
  { pid: 21028, ppid: 21027, command: 'hk run pre-commit' },
  { pid: 21029, ppid: 21028, command: 'nix eval --json .#checks' },
];

test('live work names the first command below the tool shell and counts every descendant', () => {
  const [tree] = providerTrees(commit, new Map([[97326, 'thr_idle']]));
  assert.deepEqual(liveWork(tree!, commit), { command: 'git commit -m wip', processes: 4 });
});

test('a just-forked `(zsh)` is counted but not used as the name', () => {
  const forked: Proc[] = [...commit.slice(0, 3), { pid: 21030, ppid: 21026, command: '(zsh)' }, ...commit.slice(3)];
  const [tree] = providerTrees(forked, new Map([[97326, 'thr_idle']]));
  assert.deepEqual(liveWork(tree!, forked), { command: 'git commit -m wip', processes: 5 });
});

test('a provider process with no children owns no work', () => {
  const [tree] = providerTrees(commit.slice(0, 2), new Map([[97326, 'thr_idle']]));
  assert.equal(liveWork(tree!, commit.slice(0, 2)), null);
});

test('a lone shell wrapper is still named, so the refusal never reads empty', () => {
  const shell = commit.slice(0, 3);
  const [tree] = providerTrees(shell, new Map([[97326, 'thr_idle']]));
  assert.match(liveWork(tree!, shell)!.command, /^\/bin\/zsh -c source/);
});

test('triage reports each thread\'s live work', () => {
  const trees = providerTrees([...procs, ...commit.slice(1)], new Map([...threadIds, [97326, 'thr_idle']]));
  const result = triage([...procs, ...commit.slice(1)], trees, new Map());
  assert.deepEqual(result.threads.map(thread => [thread.threadId, thread.work?.command ?? null]),
    [['thr_a', 'node /u/mcp-server.js'], ['thr_b', null], ['thr_idle', 'git commit -m wip']]);
});

test('terminate refuses reused pids, provider processes and bb itself', () => {
  const table = { procs, trees: providerTrees(procs, threadIds) };
  const chrome = procs.find(proc => proc.pid === 40)!.command;
  assert.equal(terminateRefusal({ pid: 40, command: chrome }, table, [99]), null);
  assert.match(terminateRefusal({ pid: 40, command: 'something else' }, table, [99])!, /different process/);
  assert.match(terminateRefusal({ pid: 77, command: chrome }, table, [99])!, /already exited/);
  assert.match(terminateRefusal({ pid: 22, command: 'node /u/mcp-server.js' }, table, [99])!, /Stop the thread/);
  assert.match(terminateRefusal({ pid: 10, command: procs[0]!.command }, table, [99])!, /part of bb/);
  assert.match(terminateRefusal({ pid: 1, command: '' }, table, [99])!, /cannot be ended/);
  assert.match(terminateRefusal({ pid: 99, command: '' }, table, [99])!, /cannot be ended/);
});

test('thread work: a thread with an overlapping second provider reports work if either tree has any', () => {
  const table: Proc[] = [...commit, { pid: 97400, ppid: 20, command: claude }];
  const ids = new Map([[97326, 'thr_idle'], [97400, 'thr_idle']]);
  const trees = providerTrees(table, ids);
  assert.deepEqual(threadWork(trees, table, ['thr_idle', 'thr_gone']), [{ threadId: 'thr_idle', work: { command: 'git commit -m wip', processes: 4 } }]);
  assert.deepEqual(threadWork([...trees].reverse(), table, ['thr_idle'])[0]!.work?.command, 'git commit -m wip');
});
