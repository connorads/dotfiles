// Pure presentation: tones, chip segments per width tier, the host label and
// the detail rows. The tmux pills carried state in fixed colours only; here
// each metric gets a tone so a bad reading surfaces even in the compact tier.
import { gaugeLabel } from './format.ts';
import type { Gauge, State } from './gauge.ts';
import type { Battery, Disk, Memory, Reboot, Ssh } from './vitals-parse.ts';

export type Platform = 'darwin' | 'linux' | 'other';

export type Vitals = {
  hostname: string;
  platform: Platform;
  arch: string;
  /** Null where the uptime syscall is refused (seen under the macOS agent sandbox). */
  uptimeSec: number | null;
  cores: number;
  load1: number;
  cpuPct: number | null;
  memory: Memory | null;
  disk: Disk | null;
  battery: Battery | null;
  /** Null when neither lsof nor ss is available. */
  ssh: Ssh | null;
  reboot: Reboot;
  sampledAt: number;
};

export type Machine = {
  hostId: string;
  name: string;
  /** The bb server's own machine: a thread elsewhere is remote. */
  isServer: boolean;
  status: 'connected' | 'disconnected';
  lastSeenAt: number | null;
  vitals: Vitals | null;
  /** The compressor gauge; null off macOS or where sysctl is unreadable. */
  gauge: Gauge | null;
  error: string | null;
};

export type Tone = 'ok' | 'warn' | 'critical' | 'off';

const high = (value: number, warn: number, critical: number): Tone =>
  value >= critical ? 'critical' : value >= warn ? 'warn' : 'ok';

export const cpuTone = (pct: number) => high(pct, 80, 95);
export const diskTone = (disk: Disk) => high(disk.usedPct, 90, 95);
/** macOS RAM% counts reclaimable pages and reads ~90% when healthy: no alarm there; the gauge owns it. */
export const memoryTone = (memory: Memory, platform: Platform): Tone =>
  platform === 'darwin' ? 'ok' : high(memory.usedPct, 85, 95);
export const stateTone: Record<State, Tone> = { OK: 'ok', BUSY: 'warn', CRITICAL: 'critical' };
export const batteryTone = (battery: Battery): Tone =>
  battery.onAc ? 'ok' : battery.pct <= 10 ? 'critical' : battery.pct <= 20 ? 'warn' : 'ok';

export type LabelMode = 'short' | 'full';

/**
 * Short keeps the tail, as status-right.sh's host_label does: machine names
 * share a prefix and differ at the end. Full adds the OS hostname, which can
 * differ from the name the machine was enrolled under.
 */
export function hostLabel(name: string, mode: LabelMode, hostname?: string, max = 14): string {
  if (mode === 'full') return hostname && hostname !== name ? `${name} (${hostname})` : name;
  const chars = Array.from(new Intl.Segmenter().segment(name), part => part.segment);
  return chars.length > max ? `…${chars.slice(-(max - 1)).join('')}` : name;
}

export type SegmentKey = 'offline' | 'memory' | 'reboot' | 'cpu' | 'disk' | 'battery';
/** The chip draws each key's icon; `value` is the figure beside it. */
export type Segment = { key: SegmentKey; value: string; tone: Tone; title: string };

const rebootWhy: Record<NonNullable<Reboot>, string> = {
  debian: '/var/run/reboot-required exists',
  nixos: 'the booted kernel differs from /run/current-system',
};

/**
 * Memory leads the chip. On macOS it is the compressor gauge's figure;
 * elsewhere RAM% stands in, since Linux reports a usable figure.
 */
function memorySegment(machine: Machine, v: Vitals): Segment | null {
  if (machine.gauge) {
    const { state, token } = machine.gauge;
    return { key: 'memory', value: token, tone: stateTone[state], title: gaugeLabel(machine.gauge) };
  }
  if (!v.memory) return null;
  return { key: 'memory', value: `${v.memory.usedPct}%`, tone: memoryTone(v.memory, v.platform),
    title: `RAM ${humanBytes(v.memory.usedBytes)} of ${humanBytes(v.memory.totalBytes)}` };
}

function segments(machine: Machine): Segment[] {
  const v = machine.vitals;
  if (machine.status === 'disconnected' || !v) {
    return [{ key: 'offline', value: machine.status === 'disconnected' ? 'offline' : 'no reading', tone: 'off',
      title: machine.error ?? `${machine.name} is ${machine.status}` }];
  }
  const out: Segment[] = [];
  const memory = memorySegment(machine, v);
  if (memory) out.push(memory);
  out.push(v.cpuPct === null
    ? { key: 'cpu', value: '--%', tone: 'off', title: 'CPU not sampled yet' }
    : { key: 'cpu', value: `${Math.round(v.cpuPct)}%`, tone: cpuTone(v.cpuPct), title: `CPU ${v.cpuPct}% across ${v.cores} cores` });
  if (v.disk) out.push({ key: 'disk', value: `${v.disk.usedPct}%`, tone: diskTone(v.disk),
    title: `Disk ${humanBytes(v.disk.freeBytes)} free of ${humanBytes(v.disk.totalBytes)}` });
  if (v.battery && batteryTone(v.battery) !== 'ok') out.push({ key: 'battery', value: `${v.battery.pct}%`, tone: batteryTone(v.battery),
    title: `Battery ${v.battery.pct}%, on battery` });
  if (v.reboot) out.push({ key: 'reboot', value: 'reboot', tone: 'warn', title: `Reboot required: ${rebootWhy[v.reboot]}` });
  return out;
}

export type Chip = { label: string; remote: boolean; tone: Tone; segments: Segment[]; summary: string };

/**
 * Memory, CPU and disk always show; a low battery and a due reboot join them.
 * A compact viewport keeps memory and whatever is not ok. The chip's tone is
 * the worst segment's, so its border flags any reading that needs a look.
 */
export function chip(machine: Machine, compact: boolean, mode: LabelMode): Chip {
  const all = segments(machine);
  const loud = (s: Segment) => s.tone === 'warn' || s.tone === 'critical';
  const shown = compact ? all.filter(s => loud(s) || s.key === 'memory' || s.key === 'offline') : all;
  const label = hostLabel(machine.name, mode, machine.vitals?.hostname);
  const remote = !machine.isServer;
  return {
    label, remote, segments: shown,
    tone: all.some(s => s.tone === 'critical') ? 'critical' : all.some(loud) ? 'warn' : all[0]?.key === 'offline' ? 'off' : 'ok',
    summary: [`${machine.name}${remote ? ' (remote)' : ''}`, ...all.map(s => s.title)].join('. '),
  };
}

export type Row = { label: string; value: string; tone: Tone };

export function detailRows(machine: Machine, now: number): Row[] {
  const rows: Row[] = [
    { label: 'Machine', value: `${machine.name}${machine.isServer ? ' · bb server' : ' · remote'}`, tone: 'ok' },
  ];
  const v = machine.vitals;
  if (machine.status === 'disconnected' || !v) {
    rows.push({ label: 'Status', value: machine.lastSeenAt !== null ? `${machine.status}, last seen ${humanAge(now - machine.lastSeenAt)} ago` : machine.status, tone: 'off' });
    if (machine.error) rows.push({ label: 'Error', value: machine.error, tone: 'critical' });
    return rows;
  }
  rows.push({ label: 'Host', value: `${v.hostname} · ${v.platform}/${v.arch}${v.uptimeSec === null ? '' : ` · up ${humanAge(v.uptimeSec * 1000)}`}`, tone: 'ok' });
  if (v.reboot) rows.push({ label: 'Reboot', value: `required: ${rebootWhy[v.reboot]}`, tone: 'warn' });
  if (machine.gauge) rows.push({ label: 'Memory', value: gaugeLabel(machine.gauge).replace(/^Memory /, ''), tone: stateTone[machine.gauge.state] });
  rows.push({ label: 'CPU', value: v.cpuPct === null ? 'not sampled yet' : `${v.cpuPct}% · load ${v.load1.toFixed(2)} on ${v.cores} cores`,
    tone: v.cpuPct === null ? 'off' : cpuTone(v.cpuPct) });
  if (v.memory) rows.push({ label: 'RAM', value: `${v.memory.usedPct}% · ${humanBytes(v.memory.usedBytes)} of ${humanBytes(v.memory.totalBytes)}`
    + (v.platform === 'darwin' ? ' (over-reads on macOS; trust the Memory row)' : ''), tone: memoryTone(v.memory, v.platform) });
  if (v.disk) rows.push({ label: 'Disk', value: `${v.disk.usedPct}% · ${humanBytes(v.disk.freeBytes)} free of ${humanBytes(v.disk.totalBytes)}`, tone: diskTone(v.disk) });
  if (v.battery) rows.push({ label: 'Battery', value: `${v.battery.pct}% · ${v.battery.charging ? 'charging' : v.battery.onAc ? 'on AC' : 'on battery'}`, tone: batteryTone(v.battery) });
  if (v.ssh) rows.push({ label: 'SSH', value: `${v.ssh.inbound} in · ${v.ssh.outbound} out · agent ${v.ssh.agent}`, tone: 'ok' });
  rows.push({ label: 'Sampled', value: `${humanAge(Math.max(0, now - v.sampledAt))} ago`, tone: 'ok' });
  return rows;
}

export function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function humanAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
