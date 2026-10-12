// Joins bb's view of a machine (name, connection, server role) with the host
// worker's sample. Ports keep it testable without a bb server.
import { readable, readGauge, type RawGauge } from './gauge.ts';
import type { Machine, Vitals } from './present.ts';

/** One host reading: vitals, plus compressor counters on macOS. */
export type Sample = { vitals: Vitals; memory: RawGauge | null };

export type HostInfo = {
  id: string;
  name: string;
  status: 'connected' | 'disconnected';
  lastSeenAt: number | null;
  lifecycle: { phase: string };
};

export type MachinePorts = {
  primaryHostId: () => Promise<string | null>;
  sample: (hostId: string) => Promise<Sample>;
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** A disconnected or suspended machine is not called: the call would only time out. */
export async function readMachine(host: HostInfo, ports: MachinePorts): Promise<Machine> {
  const primary = await ports.primaryHostId();
  const base = {
    hostId: host.id, name: host.name, isServer: host.id === primary,
    status: host.status, lastSeenAt: host.lastSeenAt,
  };
  if (host.status !== 'connected' || host.lifecycle.phase !== 'active') {
    return { ...base, status: 'disconnected', vitals: null, gauge: null, error: host.lifecycle.phase === 'active' ? null : `machine is ${host.lifecycle.phase}` };
  }
  try {
    const { vitals, memory } = await ports.sample(host.id);
    // Unreadable counters (blocked sysctl) would read a false all-clear `OK 0%`: no gauge instead.
    return { ...base, vitals, gauge: memory && readable(memory) ? readGauge(memory) : null, error: null };
  } catch (cause) {
    return { ...base, vitals: null, gauge: null, error: message(cause) };
  }
}

/** Every listed machine, the bb server first, then by name. Destroyed machines are dropped. */
export async function readMachines(hosts: HostInfo[], ports: MachinePorts): Promise<Machine[]> {
  const live = hosts.filter(host => host.lifecycle.phase !== 'destroyed');
  const machines = await Promise.all(live.map(host => readMachine(host, ports)));
  return machines.sort((a, b) => Number(b.isServer) - Number(a.isServer) || a.name.localeCompare(b.name));
}
