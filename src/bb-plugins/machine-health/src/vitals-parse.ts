// Pure parsers for the tool output the host worker reads. Each takes raw text
// (or numbers) and returns a reading or null; none of them fork or touch disk.

export type Memory = { usedPct: number; usedBytes: number; totalBytes: number };
export type Disk = { usedPct: number; freeBytes: number; totalBytes: number };
export type Battery = { pct: number; onAc: boolean; charging: boolean };
export type SshAgent = 'keys' | 'empty' | 'down' | 'unchecked';
export type Ssh = { inbound: number; outbound: number; agent: SshAgent };
/** Why the machine wants a reboot: Debian's flag file, or a NixOS switch to a new kernel. */
export type Reboot = 'debian' | 'nixos' | null;

const pct = (part: number, whole: number) => whole > 0 ? Math.round((100 * part) / whole) : 0;

/**
 * macOS `vm_stat`, with status-right.sh's formula: used excludes purgeable and
 * file-backed pages, so the figure tracks app memory rather than file cache.
 * It still over-reads against real pressure, so macOS shows the compressor gauge instead.
 */
export function parseVmStat(text: string): Memory | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 0);
  if (!pageSize) return null;
  const pages = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(.+?):\s+(\d+)\.?\s*$/.exec(line.trim());
    if (match) pages.set(match[1]!, Number(match[2]));
  }
  const get = (key: string) => pages.get(key) ?? 0;
  const usedCached = get('Pages active') + get('Pages inactive') + get('Pages speculative')
    + get('Pages wired down') + get('Pages occupied by compressor');
  const used = Math.max(0, usedCached - get('Pages purgeable') - get('File-backed pages'));
  const total = usedCached + get('Pages free');
  if (total === 0) return null;
  return { usedPct: pct(used, total), usedBytes: used * pageSize, totalBytes: total * pageSize };
}

/** Linux `/proc/meminfo`: used is total minus MemAvailable, the kernel's own reclaimable estimate. */
export function parseMeminfo(text: string): Memory | null {
  const kib = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
    return match ? Number(match[1]) * 1024 : null;
  };
  const total = kib('MemTotal');
  const available = kib('MemAvailable');
  if (!total || available === null) return null;
  const used = Math.max(0, total - available);
  return { usedPct: pct(used, total), usedBytes: used, totalBytes: total };
}

/** `fs.statfs` of $HOME, rounded the way `df` rounds: used / (used + available to non-root). */
export function diskFromStatfs(stats: { bsize: number; blocks: number; bfree: number; bavail: number }): Disk | null {
  if (stats.blocks <= 0) return null;
  const used = stats.blocks - stats.bfree;
  const visible = used + stats.bavail;
  return {
    usedPct: visible > 0 ? Math.ceil((100 * used) / visible) : 0,
    freeBytes: stats.bavail * stats.bsize,
    totalBytes: stats.blocks * stats.bsize,
  };
}

/**
 * macOS `pmset -g batt`. Line 1 names the power source; it is the plug signal,
 * because macOS holds near 100% on the adapter without reporting "charging".
 * No InternalBattery line means a desktop: null, and the pill hides.
 */
export function parsePmset(text: string): Battery | null {
  const battery = text.split('\n').find(line => line.includes('InternalBattery'));
  if (!battery) return null;
  const level = /(\d{1,3})%/.exec(battery);
  if (!level) return null;
  const state = battery.split(';')[1]?.trim().toLowerCase() ?? '';
  return {
    pct: Number(level[1]),
    onAc: (text.split('\n')[0] ?? '').includes("'AC Power'"),
    charging: state === 'charging' || state.includes('finishing'),
  };
}

/** Linux `/sys/class/power_supply`: one BAT* capacity and status, plus whether any Mains supply is online. */
export function batteryFromSysfs(input: { capacity: string | null; status: string | null; mainsOnline: boolean }): Battery | null {
  const capacity = Number.parseInt(input.capacity ?? '', 10);
  if (!Number.isFinite(capacity)) return null;
  const status = (input.status ?? '').trim().toLowerCase();
  return { pct: Math.min(100, Math.max(0, capacity)), onAc: input.mainsOnline, charging: status === 'charging' };
}

type Connection = { local: number; peer: number; key: string };

function connection(local: string, peer: string): Connection | null {
  const port = (address: string) => Number(address.slice(address.lastIndexOf(':') + 1));
  const l = port(local);
  const p = port(peer);
  return Number.isFinite(l) && Number.isFinite(p) ? { local: l, peer: p, key: `${local}>${peer}` } : null;
}

function countSsh(connections: Iterable<Connection | null>): Omit<Ssh, 'agent'> {
  // sshd's parent and child share one socket and lsof lists both: count each connection once.
  const seen = new Map<string, Connection>();
  for (const c of connections) if (c) seen.set(c.key, c);
  let inbound = 0;
  let outbound = 0;
  for (const c of seen.values()) {
    if (c.local === 22) inbound++;
    else if (c.peer === 22) outbound++;
  }
  return { inbound, outbound };
}

/** macOS `lsof -iTCP:22 -sTCP:ESTABLISHED -n -P`: NAME is `local->peer`. */
export function parseLsofSsh(text: string): Omit<Ssh, 'agent'> {
  return countSsh(text.split('\n').map(line => {
    const match = /\s(\S+:\d+)->(\S+:\d+)(?:\s|$)/.exec(line);
    return match ? connection(match[1]!, match[2]!) : null;
  }));
}

/** Linux `ss -tnH state established`: the last two `addr:port` columns are local and peer. */
export function parseSsSsh(text: string): Omit<Ssh, 'agent'> {
  return countSsh(text.split('\n').map(line => {
    const addresses = line.trim().split(/\s+/).filter(token => /:\d+$/.test(token));
    return addresses.length >= 2 ? connection(addresses[addresses.length - 2]!, addresses[addresses.length - 1]!) : null;
  }));
}

/** `ssh-add -l` exit status: 0 holds keys, 1 is reachable but empty, anything else cannot reach the agent. */
export function agentFromExit(code: number | null): SshAgent {
  if (code === 0) return 'keys';
  if (code === 1) return 'empty';
  return 'down';
}

/** The boot-critical parts of a NixOS system profile, as `system.autoUpgrade` compares them. */
export const nixosBootParts = ['kernel', 'initrd', 'kernel-modules'] as const;

/**
 * Debian and Ubuntu write `/var/run/reboot-required`. NixOS has no such file:
 * a reboot is due when the booted system's kernel parts resolve to other store
 * paths than the current system's. Each list holds resolved paths in
 * `nixosBootParts` order, or null where the link is missing (not NixOS).
 */
export function rebootFrom(input: { debianFlag: boolean; booted: (string | null)[]; current: (string | null)[] }): Reboot {
  if (input.debianFlag) return 'debian';
  if (input.booted.length === 0 || input.booted.some(part => part === null)) return null;
  return input.booted.some((part, i) => input.current[i] !== null && input.current[i] !== part) ? 'nixos' : null;
}
