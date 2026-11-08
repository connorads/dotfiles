import { test } from 'node:test';
import assert from 'node:assert/strict';
import { developmentServices, parseProcessTimes, parseLsofFields, identityRefusal } from './services.ts';

const times = parseProcessTimes(' 100 Sun Nov  8 12:00:00 2026 03:20:01\n 101 Sun Nov  8 12:00:01 2026 03:20:00');
const procs = [
  { pid: 100, ppid: 1, command: 'node /work/demo/node_modules/.bin/vite --host 127.0.0.1' },
  { pid: 101, ppid: 100, command: '/work/demo/workerd serve' },
  { pid: 200, ppid: 1, command: 'node /work/demo/node_modules/.bin/vite' },
  { pid: 300, ppid: 1, command: 'node important-service.js' },
];

test('keeps independent servers separate and counts a worker only once', () => {
  const groups = developmentServices(procs, [], { footprints: new Map([[100, 100], [101, 200]]), times, directories: new Map(), listeners: new Map() });
  assert.deepEqual(groups.map(g => [g.rootPid, g.processes.map(p => p.pid), g.mb]), [[100, [100, 101], 300], [200, [200], 0]]);
  assert.equal(groups[0]!.evidence, 'Parent exited; owner unknown');
});

test('protects development processes belonging to active provider infrastructure', () => {
  const groups = developmentServices(procs, [{ rootPid: 100, threadId: 'thr_demo', pids: [100, 101] }], { footprints: new Map(), times, directories: new Map(), listeners: new Map() });
  assert.equal(groups[0]!.processes[0]!.owner, 'thread');
  assert.equal(groups[0]!.evidence, 'Owned by a BB provider');
});

test('reads macOS start times and multi-day elapsed times', () => {
  assert.deepEqual(parseProcessTimes(' 10 Sun Nov  8 12:00:00 2026 12-03:04:05').get(10),
    { started: 'Sun Nov 8 12:00:00 2026', ageSec: 1047845 });
});

test('reads listener and cwd fields without conflating PIDs', () => {
  assert.deepEqual([...parseLsofFields('p100\nfcwd\nn/work/demo\np200\nf4\nn127.0.0.1:5180\nf5\nn[::1]:5180\n')],
    [[100, ['/work/demo']], [200, ['127.0.0.1:5180', '[::1]:5180']]]);
});

test('a recycled PID with the same command is refused when its start time changes', () => {
  assert.match(identityRefusal('Sun Nov 8 12:00:00 2026', 'Sun Nov 8 13:00:00 2026') ?? '', /changed/);
  assert.match(identityRefusal(null, 'Sun Nov 8 12:00:00 2026') ?? '', /verify/);
  assert.equal(identityRefusal('same', 'same'), null);
});

test('headless automation appears without a listening port; desktop browsers do not', () => {
  const groups = developmentServices([
    { pid: 400, ppid: 1, command: '/cache/ms-playwright/chromium/chrome --headless' },
    { pid: 401, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  ], [], { footprints: new Map(), times: new Map(), directories: new Map(), listeners: new Map() });
  assert.deepEqual(groups.map(g => g.rootPid), [400]);
});
