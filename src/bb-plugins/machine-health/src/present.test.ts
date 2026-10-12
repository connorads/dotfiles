import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGauge, type RawGauge } from './gauge.ts';
import { chip, detailRows, hostLabel, humanAge, humanBytes, type Machine, type Vitals } from './present.ts';

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
const texts = (c: ReturnType<typeof chip>) => c.segments.map(s => `${s.key} ${s.value}`);

test('memory, CPU and disk always show; a healthy battery stays out', () => {
  const c = chip(machine(), false, 'short');
  assert.deepEqual(texts(c), ['memory 21%', 'cpu 12%', 'disk 70%']);
  assert.equal(c.tone, 'ok');
  assert.equal(c.remote, false);
});

test('a compact viewport on a healthy machine shows only memory', () => {
  assert.deepEqual(texts(chip(machine(), true, 'short')), ['memory 21%']);
});

test('the worst reading sets the chip tone; each segment keeps its own', () => {
  const busy = chip(machine({ gauge: readGauge(raw({ pages: 620, pressure: 2 })) }), true, 'short');
  assert.deepEqual(texts(busy), ['memory ▲62%']);
  assert.equal(busy.tone, 'warn');
  const disk = chip(machine({ vitals: vitals({ disk: { usedPct: 97, freeBytes: GiB, totalBytes: 460 * GiB } }) }), true, 'short');
  assert.deepEqual(texts(disk), ['memory 21%', 'disk 97%']);
  assert.equal(disk.tone, 'critical');
  assert.equal(disk.segments[0]?.tone, 'ok');
});

test('macOS without a readable gauge falls back to a quiet RAM figure', () => {
  const c = chip(machine({ gauge: null }), true, 'short');
  assert.deepEqual(texts(c), ['memory 91%']);
  assert.equal(c.tone, 'ok');
  assert.match(c.summary, /RAM .* of /);
});

test('Linux RAM has a tone; an unplugged low battery joins the chip', () => {
  const linux = chip(machine({ gauge: null, vitals: vitals({ platform: 'linux', memory: { usedPct: 88, usedBytes: 7 * GiB, totalBytes: 8 * GiB } }) }), true, 'short');
  assert.deepEqual(texts(linux), ['memory 88%']);
  assert.equal(linux.tone, 'warn');
  const low = chip(machine({ vitals: vitals({ battery: { pct: 9, onAc: false, charging: false } }) }), true, 'short');
  assert.deepEqual(texts(low), ['memory 21%', 'battery 9%']);
  assert.equal(low.segments[1]?.tone, 'critical');
});

test('a NixOS rpi due a reboot shows the marker even when compact, with the reason', () => {
  const pi = machine({ name: 'rpi5', isServer: false, gauge: null,
    vitals: vitals({ platform: 'linux', battery: null, reboot: 'nixos', memory: { usedPct: 40, usedBytes: 3 * GiB, totalBytes: 8 * GiB } }) });
  const c = chip(pi, true, 'short');
  assert.deepEqual(texts(c), ['memory 40%', 'reboot reboot']);
  assert.equal(c.remote, true);
  assert.match(c.summary, /^rpi5 \(remote\)/);
  assert.match(c.summary, /booted kernel differs/);
});

test('a disconnected machine shows offline and no figures', () => {
  const c = chip(machine({ status: 'disconnected', vitals: null, gauge: null }), false, 'short');
  assert.deepEqual(texts(c), ['offline offline']);
  assert.equal(c.tone, 'off');
});

test('host label keeps the distinctive tail; full mode adds the OS hostname', () => {
  assert.equal(hostLabel('rpi5', 'short'), 'rpi5');
  assert.equal(hostLabel('Connor’s MacBook Air', 'short'), '…s MacBook Air');
  assert.equal(hostLabel('Connor’s MacBook Air', 'full', 'connors-mbair.local'), 'Connor’s MacBook Air (connors-mbair.local)');
  assert.equal(hostLabel('rpi5', 'full', 'rpi5'), 'rpi5');
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
