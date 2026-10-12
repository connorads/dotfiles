import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGauge, type RawGauge } from './gauge.ts';
import { chip, detailRows, hostLabel, humanAge, humanBytes, tierFor, type Machine, type Vitals } from './present.ts';

const GiB = 1024 ** 3;
const vitals = (over: Partial<Vitals> = {}): Vitals => ({
  hostname: 'connors-mbair.local', platform: 'darwin', arch: 'arm64', uptimeSec: 3 * 3600, cores: 8, load1: 2.5,
  cpuPct: 12.4,
  memory: { usedPct: 91, usedBytes: 14.5 * GiB, totalBytes: 16 * GiB },
  disk: { usedPct: 70, freeBytes: 140 * GiB, totalBytes: 460 * GiB },
  battery: { pct: 100, onAc: true, charging: false },
  ssh: { inbound: 0, outbound: 0, agent: 'unchecked' },
  reboot: null, sampledAt: 1_000,
  ...over,
});
const raw = (over: Partial<RawGauge> = {}): RawGauge => ({
  pressure: 1, pages: 210, pagesLimit: 1000, segments: 190, segmentsLimit: 1000,
  pageSize: 16384, segmentSize: 65536, swapUsedMb: 0, swapTotalMb: 0, wiredMb: 0, ...over,
});
const machine = (over: Partial<Machine> = {}): Machine => ({
  hostId: 'host_1', name: 'Connor’s MacBook Air', isServer: true, status: 'connected', lastSeenAt: 1_000,
  vitals: vitals(), gauge: readGauge(raw()), error: null, ...over,
});
const texts = (c: ReturnType<typeof chip>) => c.segments.map(s => s.text);

test('full tier leads with the memory gauge, then every vitals pill', () => {
  const c = chip(machine(), 'full', 'short');
  assert.deepEqual(texts(c), ['⬡ 21%', 'CPU 12%', 'Disk 70%', 'Bat 100% AC']);
  assert.equal(c.tone, 'ok');
  assert.equal(c.remote, false);
});

test('compact tier on a healthy machine shows only memory', () => {
  assert.deepEqual(texts(chip(machine(), 'compact', 'short')), ['⬡ 21%']);
});

test('memory pressure sets the chip tone; another bad pill keeps its own tone', () => {
  const busy = chip(machine({ gauge: readGauge(raw({ pages: 620, pressure: 2 })) }), 'compact', 'short');
  assert.deepEqual(texts(busy), ['⊟ ▲62%']);
  assert.equal(busy.tone, 'warn');
  const disk = chip(machine({ vitals: vitals({ disk: { usedPct: 97, freeBytes: GiB, totalBytes: 460 * GiB } }) }), 'compact', 'short');
  assert.deepEqual(texts(disk), ['⬡ 21%', 'Disk 97%']);
  assert.equal(disk.tone, 'ok');
  assert.equal(disk.segments[1]?.tone, 'critical');
});

test('macOS without a readable gauge falls back to a quiet RAM figure', () => {
  const c = chip(machine({ gauge: null }), 'compact', 'short');
  assert.deepEqual(texts(c), ['RAM 91%']);
  assert.equal(c.tone, 'ok');
});

test('medium tier keeps memory, CPU and SSH, like print_medium keeps git and ssh', () => {
  const c = chip(machine({ vitals: vitals({ ssh: { inbound: 1, outbound: 2, agent: 'keys' } }) }), 'medium', 'short');
  assert.deepEqual(texts(c), ['⬡ 21%', 'CPU 12%', 'SSH 1↓2↑ key']);
});

test('Linux RAM drives the tone; an unplugged low battery raises its own pill', () => {
  const linux = chip(machine({ gauge: null, vitals: vitals({ platform: 'linux', memory: { usedPct: 88, usedBytes: 7 * GiB, totalBytes: 8 * GiB } }) }), 'compact', 'short');
  assert.deepEqual(texts(linux), ['RAM 88%']);
  assert.equal(linux.tone, 'warn');
  const low = chip(machine({ vitals: vitals({ battery: { pct: 9, onAc: false, charging: false } }) }), 'compact', 'short');
  assert.deepEqual(texts(low), ['⬡ 21%', 'Bat 9%']);
  assert.equal(low.segments[1]?.tone, 'critical');
});

test('a NixOS rpi due a reboot shows the marker in every tier, with the reason', () => {
  const pi = machine({ name: 'rpi5', isServer: false, gauge: null,
    vitals: vitals({ platform: 'linux', battery: null, reboot: 'nixos', memory: { usedPct: 40, usedBytes: 3 * GiB, totalBytes: 8 * GiB } }) });
  const c = chip(pi, 'compact', 'short');
  assert.deepEqual(texts(c), ['RAM 40%', 'reboot']);
  assert.equal(c.remote, true);
  assert.match(c.summary, /^rpi5 \(remote\)/);
  assert.match(c.summary, /booted kernel differs/);
});

test('a disconnected machine shows offline and no figures', () => {
  const c = chip(machine({ status: 'disconnected', vitals: null, gauge: null }), 'full', 'short');
  assert.deepEqual(texts(c), ['offline']);
  assert.equal(c.tone, 'off');
});

test('host label keeps the distinctive tail; full mode adds the OS hostname', () => {
  assert.equal(hostLabel('rpi5', 'short'), 'rpi5');
  assert.equal(hostLabel('Connor’s MacBook Air', 'short'), '…s MacBook Air');
  assert.equal(hostLabel('Connor’s MacBook Air', 'full', 'connors-mbair.local'), 'Connor’s MacBook Air (connors-mbair.local)');
  assert.equal(hostLabel('rpi5', 'full', 'rpi5'), 'rpi5');
});

test('tier follows pane width, and a compact viewport always wins', () => {
  assert.equal(tierFor(1200, false), 'full');
  assert.equal(tierFor(700, false), 'medium');
  assert.equal(tierFor(400, false), 'compact');
  assert.equal(tierFor(1200, true), 'compact');
});

test('detail rows give the memory state, the macOS RAM caveat and the sample age', () => {
  const rows = detailRows(machine(), 31_000);
  assert.match(rows.find(r => r.label === 'Memory')?.value ?? '', /^OK: slots 21%/);
  assert.match(rows.find(r => r.label === 'RAM')?.value ?? '', /over-reads on macOS/);
  assert.equal(rows.find(r => r.label === 'Sampled')?.value, '30s ago');
  assert.equal(rows.find(r => r.label === 'CPU')?.value, '12.4% · load 2.50 on 8 cores');
});

test('detail rows for an offline machine give last seen', () => {
  const rows = detailRows(machine({ status: 'disconnected', vitals: null, gauge: null, lastSeenAt: 0 }), 2 * 3600_000);
  assert.deepEqual(rows.map(r => r.label), ['Machine', 'Status']);
  assert.equal(rows[1]?.value, 'disconnected, last seen 2h ago');
});

test('human units', () => {
  assert.equal(humanBytes(14.5 * GiB), '14.5 GB');
  assert.equal(humanBytes(460 * GiB), '460 GB');
  assert.equal(humanAge(59_000), '59s');
  assert.equal(humanAge(3 * 86_400_000), '3d');
});
