import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appName, parsePs, parseSwap, parseThreadIds, parseTopMem, parseWiredMb, rawGauge, sizeMb } from './parse.ts';

const sysctl = `kern.memorystatus_vm_pressure_level: 2
vm.compressor.pages_compressed: 620
vm.compressor.pages_compressed_limit: 1000
vm.compressor.segment.total: 270
vm.compressor.segment.limit: 1000
vm.swapusage: total = 7168.00M  used = 6002.94M  free = 1165.06M  (encrypted)
hw.pagesize: 16384
vm.compressor_segment_buffer_size: 65536
`;
const vmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               12345.
Pages wired down:                        230400.
`;

test('sysctl lines are read by key into the raw gauge', () => {
  assert.deepEqual(rawGauge(sysctl, vmStat), {
    pressure: 2, pages: 620, pagesLimit: 1000, segments: 270, segmentsLimit: 1000,
    pageSize: 16384, segmentSize: 65536, swapUsedMb: 6002, swapTotalMb: 7168, wiredMb: 3600,
  });
});

test('a missing sysctl key zeroes only its own field', () => {
  const partial = sysctl.split('\n').filter(line => !line.startsWith('vm.compressor.segment.total')).join('\n');
  const raw = rawGauge(partial, '');
  assert.equal(raw.segments, 0);
  assert.equal(raw.segmentsLimit, 1000);
  assert.equal(raw.pages, 620);
  assert.equal(raw.wiredMb, 0);
});

test('non-macOS output reads zeros with default sizes', () => {
  const raw = rawGauge('', '');
  assert.equal(raw.pressure, 1);
  assert.equal(raw.pagesLimit, 0);
  assert.equal(raw.pageSize, 16384);
});

test('sizes normalise to whole MB', () => {
  assert.equal(sizeMb('3109.69M'), 3109);
  assert.equal(sizeMb('1.5G'), 1536);
  assert.equal(sizeMb('2048K'), 2);
  assert.equal(sizeMb('479M+'), 479);
  assert.equal(sizeMb('2097152'), 2);
  assert.equal(sizeMb('n/a'), 0);
  assert.deepEqual(parseSwap(undefined), { usedMb: 0, totalMb: 0 });
});

test('wired is pages times the reported page size', () => {
  assert.equal(parseWiredMb(vmStat), 3600);
});

test('ps rows keep the whole command', () => {
  assert.deepEqual(parsePs('  101     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag\n'), [
    { pid: 101, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag' },
  ]);
});

test('only BB_THREAD_ID survives the environment dump', () => {
  const ids = parseThreadIds([
    '13698 /x/claude --session-id=abc HOME=/Users/me SERVICE_TOKEN=not-a-real-token BB_THREAD_ID=thr_6d9wg6i4hu BB_PROJECT_ID=prj_1',
    '200 /bin/zsh HOME=/Users/me',
    '201 /bin/zsh NOT_BB_THREAD_ID=thr_fake',
  ].join('\n'));
  assert.deepEqual([...ids], [[13698, 'thr_6d9wg6i4hu']]);
});

test('top MEM rows are read after the header', () => {
  const top = `Processes: 600 total\nPID    MEM\n13698  479M+\n99405  1.2G\n12 512K-\n`;
  assert.deepEqual([...parseTopMem(top)], [[13698, 479], [99405, 1228], [12, 0]]);
});

test('helpers roll up to the outer app bundle', () => {
  assert.equal(appName('/Applications/Google Chrome.app/Contents/Frameworks/x/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer'), 'Google Chrome');
  assert.equal(appName('/Users/me/.local/share/mise/installs/claude/2.1.293/claude --output-format stream-json'), 'claude');
  assert.equal(appName('codex app-server'), 'codex');
});
