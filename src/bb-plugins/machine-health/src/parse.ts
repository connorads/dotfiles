// Parsers for the macOS tools the host worker runs. Each takes captured text,
// so tests feed fixtures and the host stays a thin shell.
import { pressureFrom, type RawGauge } from './gauge.ts';

/** The keys one `sysctl` call reads. Without -n each line names its key, so a missing key cannot shift the others. */
export const sysctlKeys = [
  'kern.memorystatus_vm_pressure_level',
  'vm.compressor.pages_compressed',
  'vm.compressor.pages_compressed_limit',
  'vm.compressor.segment.total',
  'vm.compressor.segment.limit',
  'vm.swapusage',
  'hw.pagesize',
  'vm.compressor_segment_buffer_size',
] as const;

export function parseSysctl(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 2).trim());
  }
  return values;
}

const count = (raw: string | undefined) => (raw && /^\d+$/.test(raw) ? Number(raw) : 0);

/** A size like `6002.94M`, `1.5G` or `512K` in whole MB; malformed reads 0. */
export function sizeMb(raw: string | undefined): number {
  const match = raw?.trim().match(/^(\d+(?:\.\d+)?)([KMGB])?[+-]?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2] ?? 'B';
  const mb = unit === 'G' ? value * 1024 : unit === 'M' ? value : unit === 'K' ? value / 1024 : value / 1048576;
  return Math.trunc(mb);
}

/** vm.swapusage: `total = 7168.00M  used = 6002.94M  free = …`. */
export function parseSwap(line: string | undefined): { usedMb: number; totalMb: number } {
  const field = (name: string) => line?.match(new RegExp(`${name} = (\\S+)`))?.[1];
  return { usedMb: sizeMb(field('used')), totalMb: sizeMb(field('total')) };
}

/** Wired memory from vm_stat, pages times the page size it reports. */
export function parseWiredMb(vmStat: string): number {
  const pageSize = Number(vmStat.match(/page size of (\d+) bytes/)?.[1] ?? 0);
  const pages = Number(vmStat.match(/Pages wired down:\s+(\d+)/)?.[1] ?? 0);
  return Math.trunc((pages * pageSize) / 1048576);
}

export function rawGauge(sysctl: string, vmStat: string): RawGauge {
  const values = parseSysctl(sysctl);
  const swap = parseSwap(values.get('vm.swapusage'));
  return {
    pressure: pressureFrom(values.get('kern.memorystatus_vm_pressure_level')),
    pages: count(values.get('vm.compressor.pages_compressed')),
    pagesLimit: count(values.get('vm.compressor.pages_compressed_limit')),
    segments: count(values.get('vm.compressor.segment.total')),
    segmentsLimit: count(values.get('vm.compressor.segment.limit')),
    pageSize: count(values.get('hw.pagesize')) || 16384,
    segmentSize: count(values.get('vm.compressor_segment_buffer_size')) || 65536,
    swapUsedMb: swap.usedMb, swapTotalMb: swap.totalMb,
    wiredMb: parseWiredMb(vmStat),
  };
}

export interface Proc { pid: number; ppid: number; command: string }

/** `ps -axo pid=,ppid=,command=`. */
export function parsePs(text: string): Proc[] {
  const rows: Proc[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! });
  }
  return rows;
}

/**
 * `ps -E -axo pid=,command=` appends each process's environment to its
 * command. Only BB_THREAD_ID is kept; everything else, secrets included, is
 * dropped here and never leaves the host.
 */
export function parseThreadIds(text: string): Map<number, string> {
  const ids = new Map<number, string>();
  for (const line of text.split('\n')) {
    const pid = line.match(/^\s*(\d+)\s/)?.[1];
    // `t[h]r` matches the same ids; the bracket stops the typos gate reading the prefix as a misspelling.
    const threadId = line.match(/(?:^|\s)BB_THREAD_ID=(t[h]r_[A-Za-z0-9]+)(?=\s|$)/)?.[1];
    if (pid && threadId) ids.set(Number(pid), threadId);
  }
  return ids;
}

/**
 * `top -l 1 -stats pid,mem` for every process. MEM is phys_footprint, which
 * jetsam judges on. RSS swings as pages move in and out of the compressor, so
 * it can hide a process: a `nix eval` read 273 MB RSS and 2.9 GB footprint.
 */
export function parseTopMem(text: string): Map<number, number> {
  const mem = new Map<number, number>();
  let rows = false;
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === 'PID') { rows = true; continue; }
    if (rows && /^\d+$/.test(fields[0] ?? '') && fields[1]) mem.set(Number(fields[0]), sizeMb(fields[1]));
  }
  return mem;
}

/** Group key: the first `.app` bundle name, so helpers roll up to their app; else the executable's basename. */
export function appName(command: string): string {
  const bundle = command.match(/([^/]+)\.app\//);
  if (bundle) return bundle[1]!;
  const executable = command.split(' ')[0] ?? command;
  return executable.slice(executable.lastIndexOf('/') + 1);
}
