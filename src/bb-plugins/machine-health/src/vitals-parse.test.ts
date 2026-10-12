import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentFromExit, batteryFromSysfs, diskFromStatfs, parseLsofSsh, parseMeminfo, parsePmset, parseSsSsh, parseVmStat, rebootFrom,
} from './vitals-parse.ts';

const vmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    10000.
Pages active:                                  40000.
Pages inactive:                                30000.
Pages speculative:                              5000.
Pages throttled:                                   0.
Pages wired down:                              15000.
Pages purgeable:                                2000.
"Translation faults":                      123456789.
File-backed pages:                             18000.
Pages occupied by compressor:                  10000.
`;

test('vm_stat: used excludes purgeable and file-backed pages, as status-right.sh does', () => {
  // used_cached = 40k+30k+5k+15k+10k = 100k; used = 100k-2k-18k = 80k; total = 110k
  const memory = parseVmStat(vmStat);
  assert.deepEqual(memory, { usedPct: 73, usedBytes: 80_000 * 16384, totalBytes: 110_000 * 16384 });
});

test('vm_stat without a page size header reads as no reading', () => {
  assert.equal(parseVmStat('Pages free: 10.\n'), null);
});

test('meminfo: used is total minus MemAvailable', () => {
  const memory = parseMeminfo('MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    2000000 kB\n');
  assert.deepEqual(memory, { usedPct: 75, usedBytes: 6_000_000 * 1024, totalBytes: 8_000_000 * 1024 });
  assert.equal(parseMeminfo('MemTotal: 8000000 kB\n'), null);
});

test('statfs rounds up like df: this Mac read 97% in both', () => {
  const disk = diskFromStatfs({ bsize: 4096, blocks: 120686613, bfree: 3651217, bavail: 3651217 });
  assert.equal(disk?.usedPct, 97);
  assert.equal(disk?.freeBytes, 3651217 * 4096);
});

test('statfs: root-reserved blocks count as neither used nor available', () => {
  // ext4 reserves 5%: 100 blocks, 40 free, 35 available to users -> 60 / 95
  assert.equal(diskFromStatfs({ bsize: 1, blocks: 100, bfree: 40, bavail: 35 })?.usedPct, 64);
});

test('pmset: AC Power on line 1 means plugged even when holding at 100%', () => {
  const battery = parsePmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=25559139)\t100%; charged; 0:00 remaining present: true\n");
  assert.deepEqual(battery, { pct: 100, onAc: true, charging: false });
});

test('pmset: discharging and charging states', () => {
  assert.deepEqual(parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t18%; discharging; 1:02 remaining present: true\n"),
    { pct: 18, onAc: false, charging: false });
  assert.deepEqual(parsePmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t64%; charging; 0:40 remaining present: true\n"),
    { pct: 64, onAc: true, charging: true });
});

test('pmset on a desktop Mac has no battery', () => {
  assert.equal(parsePmset("Now drawing from 'AC Power'\n"), null);
});

test('sysfs battery: capacity, charging status and mains supply', () => {
  assert.deepEqual(batteryFromSysfs({ capacity: '42\n', status: 'Charging\n', mainsOnline: true }), { pct: 42, onAc: true, charging: true });
  assert.equal(batteryFromSysfs({ capacity: null, status: null, mainsOnline: false }), null);
  assert.equal(batteryFromSysfs({ capacity: '104\n', status: 'Full\n', mainsOnline: true })?.pct, 100);
});

const lsof = `COMMAND   PID      USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
ssh     83202 connorads    3u  IPv4 0x557dfd8c47ead41c      0t0  TCP 100.90.109.86:57218->100.125.154.87:22 (ESTABLISHED)
sshd     9001 root         4u  IPv4 0x1111111111111111      0t0  TCP 192.168.1.5:22->192.168.1.9:50000 (ESTABLISHED)
sshd     9002 connorads    4u  IPv4 0x1111111111111111      0t0  TCP 192.168.1.5:22->192.168.1.9:50000 (ESTABLISHED)
ssh      7000 connorads    3u  IPv6 0x2222222222222222      0t0  TCP [fd7a::1]:60000->[fd7a::2]:22 (ESTABLISHED)
`;

test('lsof: one inbound (counted once across sshd parent and child) and two outbound', () => {
  assert.deepEqual(parseLsofSsh(lsof), { inbound: 1, outbound: 2 });
  assert.deepEqual(parseLsofSsh(''), { inbound: 0, outbound: 0 });
});

test('ss: last two address columns are local and peer', () => {
  const ss = `0      0      192.168.1.20:22      192.168.1.9:51000
0      0      192.168.1.20:44312   140.82.121.4:22
0      0      [::ffff:10.0.0.2]:22 [::ffff:10.0.0.3]:40000
0      0      192.168.1.20:443     1.1.1.1:55000
`;
  assert.deepEqual(parseSsSsh(ss), { inbound: 2, outbound: 1 });
});

test('ssh-add exit codes map to agent state', () => {
  assert.equal(agentFromExit(0), 'keys');
  assert.equal(agentFromExit(1), 'empty');
  assert.equal(agentFromExit(2), 'down');
  assert.equal(agentFromExit(null), 'down');
});

test('reboot: the Debian flag file, or a NixOS kernel that differs from the booted one', () => {
  const same = ['/nix/store/k1', '/nix/store/i1', '/nix/store/m1'];
  assert.equal(rebootFrom({ debianFlag: true, booted: [], current: [] }), 'debian');
  assert.equal(rebootFrom({ debianFlag: false, booted: same, current: same }), null);
  assert.equal(rebootFrom({ debianFlag: false, booted: same, current: ['/nix/store/k2', ...same.slice(1)] }), 'nixos');
});

test('reboot: a machine without /run/booted-system is not NixOS and never asks', () => {
  assert.equal(rebootFrom({ debianFlag: false, booted: [null, null, null], current: [null, null, null] }), null);
  assert.equal(rebootFrom({ debianFlag: false, booted: ['/nix/store/k1', '/nix/store/i1', '/nix/store/m1'], current: [null, null, null] }), null);
});
