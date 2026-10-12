import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMachine, readMachines, type HostInfo, type MachinePorts, type Sample } from './machine.ts';
import type { RawGauge } from './gauge.ts';
import type { Vitals } from './present.ts';

const host = (over: Partial<HostInfo> = {}): HostInfo => ({
  id: 'host_mac', name: 'MacBook Air', status: 'connected', lastSeenAt: 5, lifecycle: { phase: 'active' }, ...over,
});
const sample: Sample = { vitals: { hostname: 'h' } as Vitals, memory: null };
const counters: RawGauge = { pressure: 1, pages: 620, pagesLimit: 1000, segments: 100, segmentsLimit: 1000,
  pageSize: 16384, segmentSize: 65536, swapUsedMb: 0, swapTotalMb: 0, wiredMb: 0 };

/** A fake fleet: per-host sample results, with a log of which machines were called. */
function fleet(results: Record<string, Sample | Error>, primary = 'host_mac') {
  const called: string[] = [];
  const ports: MachinePorts = {
    primaryHostId: async () => primary,
    sample: async hostId => {
      called.push(hostId);
      const result = results[hostId];
      if (!result) throw new Error(`no fake for ${hostId}`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { ports, called };
}

test('the server machine is marked; another machine is remote', async () => {
  const { ports } = fleet({ host_mac: sample, host_pi: sample });
  assert.equal((await readMachine(host(), ports)).isServer, true);
  assert.equal((await readMachine(host({ id: 'host_pi' }), ports)).isServer, false);
});

test('a disconnected or suspended machine is not called', async () => {
  const { ports, called } = fleet({});
  const off = await readMachine(host({ status: 'disconnected' }), ports);
  const parked = await readMachine(host({ lifecycle: { phase: 'suspended' } }), ports);
  assert.deepEqual(called, []);
  assert.deepEqual([off.status, off.error], ['disconnected', null]);
  assert.deepEqual([parked.status, parked.error], ['disconnected', 'machine is suspended']);
});

test('a failed sample becomes an error on that machine only', async () => {
  const { ports } = fleet({ host_mac: sample, host_pi: new Error('host worker timed out') });
  const machines = await readMachines([host({ id: 'host_pi', name: 'rpi5' }), host()], ports);
  assert.deepEqual(machines.map(m => [m.name, m.vitals ? 'ok' : m.error]), [['MacBook Air', 'ok'], ['rpi5', 'host worker timed out']]);
});

test('the list puts the server first, then sorts by name, and drops destroyed machines', async () => {
  const { ports } = fleet({ host_mac: sample, host_b: sample, host_a: sample });
  const machines = await readMachines([
    host({ id: 'host_b', name: 'devbox' }), host({ id: 'host_a', name: 'rpi5' }),
    host({ id: 'host_x', name: 'old', lifecycle: { phase: 'destroyed' } }), host(),
  ], ports);
  assert.deepEqual(machines.map(m => m.name), ['MacBook Air', 'devbox', 'rpi5']);
});

test('compressor counters become the gauge; unreadable ones give none rather than a false OK', async () => {
  const { ports } = fleet({ host_mac: { ...sample, memory: counters }, host_pi: { ...sample, memory: { ...counters, pagesLimit: 0 } } });
  assert.equal((await readMachine(host(), ports)).gauge?.state, 'BUSY');
  assert.equal((await readMachine(host({ id: 'host_pi' }), ports)).gauge, null);
});
