import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts.ts';
import { createCpuSampler, snapshot } from './src/cpu.ts';
import type { Sample } from './src/machine.ts';
import { parsePs, parseThreadIds, parseTopMem, rawGauge, sysctlKeys } from './src/parse.ts';
import type { Platform } from './src/present.ts';
import { providerTrees, terminateRefusal, threadWork, triage } from './src/triage.ts';
import {
  agentFromExit, batteryFromSysfs, diskFromStatfs, nixosBootParts, parseLsofSsh, parseMeminfo, parsePmset, parseSsSsh,
  parseVmStat, rebootFrom, type Battery, type Ssh,
} from './src/vitals-parse.ts';

/**
 * System dirs first so a user PATH cannot shadow lsof or vm_stat. NixOS keeps
 * `ss` and `ssh-add` in /run/current-system/sw/bin, not /usr/bin (the rpi5);
 * the inherited PATH covers other layouts.
 */
export const toolPath = (inherited = process.env.PATH ?? '') =>
  ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/run/current-system/sw/bin', ...inherited.split(':')]
    .filter((dir, i, all) => dir && all.indexOf(dir) === i).join(':');
const platform: Platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : 'other';

/**
 * Output and exit code. Tools get only LC_ALL and PATH (plus `env`), never the
 * worker's own environment. Stdout survives a non-zero exit: sysctl exits 1 on
 * one unknown key but prints the rest. A missing tool, or a spawn refused
 * synchronously (EPERM under a sandbox), reads as empty output and a null code.
 */
function run(file: string, args: string[], signal: AbortSignal, options: { timeoutMs?: number; env?: Record<string, string> } = {}) {
  return new Promise<{ stdout: string; code: number | null }>(resolve => {
    try {
      execFile(file, args, { signal, timeout: options.timeoutMs ?? 15_000, maxBuffer: 64 * 1024 * 1024,
        env: { LC_ALL: 'C', PATH: toolPath(), ...options.env } },
      (error, stdout) => {
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ stdout: typeof stdout === 'string' ? stdout : '', code });
      });
    } catch {
      resolve({ stdout: '', code: null });
    }
  });
}
const capture = async (file: string, args: string[], signal: AbortSignal) => (await run(file, args, signal)).stdout;
const text = (file: string) => readFile(file, 'utf8').catch(() => null);
/** One failing probe must not cost the whole reading: it reads as null. */
const soft = <T,>(read: () => T): T | null => { try { return read(); } catch { return null; } };
const softly = <T,>(read: Promise<T | null>) => read.catch(() => null);

// Module state lives as long as the worker: a warm worker diffs against its last call.
const cpu = createCpuSampler({
  read: () => snapshot(os.cpus()),
  now: Date.now,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  windowMs: 250,
  maxAgeMs: 60_000,
});

/** sysctl and vm_stat once each: vm_stat feeds both the gauge's wired figure and RAM%. */
async function darwinMemory(signal: AbortSignal) {
  const [sysctl, vmStat] = await Promise.all([
    capture('/usr/sbin/sysctl', [...sysctlKeys], signal),
    capture('/usr/bin/vm_stat', [], signal),
  ]);
  return { raw: rawGauge(sysctl, vmStat), ram: parseVmStat(vmStat) };
}

async function linuxBattery(): Promise<Battery | null> {
  const root = '/sys/class/power_supply';
  const supplies = await readdir(root).catch(() => [] as string[]);
  const bat = supplies.find(name => name.startsWith('BAT'));
  if (!bat) return null;
  const mains = await Promise.all(supplies.map(async name =>
    (await text(path.join(root, name, 'type')))?.trim() === 'Mains' && (await text(path.join(root, name, 'online')))?.trim() === '1'));
  return batteryFromSysfs({
    capacity: await text(path.join(root, bat, 'capacity')),
    status: await text(path.join(root, bat, 'status')),
    mainsOnline: mains.some(Boolean),
  });
}

async function battery(signal: AbortSignal): Promise<Battery | null> {
  if (platform === 'darwin') return parsePmset(await capture('/usr/bin/pmset', ['-g', 'batt'], signal));
  if (platform === 'linux') return linuxBattery();
  return null;
}

/**
 * Agent liveness only matters once SSH is in use, as in status-right.sh. The
 * stable `~/.ssh/agent.sock` symlink wins over the worker's inherited socket.
 * `ssh-add -l` lists key fingerprints on stdout; only the exit code is kept.
 */
async function ssh(signal: AbortSignal): Promise<Ssh | null> {
  let counts: Omit<Ssh, 'agent'>;
  if (platform === 'darwin') {
    const lsof = await run('/usr/sbin/lsof', ['-iTCP:22', '-sTCP:ESTABLISHED', '-n', '-P'], signal);
    // lsof exits 1 when nothing matches; null means the tool is missing.
    if (lsof.code === null) return null;
    counts = parseLsofSsh(lsof.stdout);
  } else if (platform === 'linux') {
    const ss = await run('ss', ['-tnH', 'state', 'established'], signal);
    if (ss.code !== 0) return null;
    counts = parseSsSsh(ss.stdout);
  } else return null;
  if (counts.inbound === 0 && counts.outbound === 0) return { ...counts, agent: 'unchecked' };
  const stable = path.join(os.homedir(), '.ssh', 'agent.sock');
  const socket = existsSync(stable) ? stable : process.env.SSH_AUTH_SOCK;
  if (!socket) return { ...counts, agent: 'down' };
  const probe = await run('ssh-add', ['-l'], signal, { timeoutMs: 1_000, env: { SSH_AUTH_SOCK: socket } });
  return { ...counts, agent: agentFromExit(probe.code) };
}

async function disk() {
  try { return diskFromStatfs(await statfs(os.homedir())); } catch { return null; }
}

async function reboot() {
  const parts = (system: string) => Promise.all(nixosBootParts.map(part => realpath(`/run/${system}/${part}`).catch(() => null)));
  const [booted, current] = await Promise.all([parts('booted-system'), parts('current-system')]);
  return rebootFrom({ debianFlag: existsSync('/var/run/reboot-required'), booted, current });
}

/**
 * The process table and each provider tree. `ps -E` appends every process's
 * environment; parseThreadIds keeps BB_THREAD_ID and drops the rest, secrets
 * included, before anything leaves this function.
 */
async function readProcesses(signal: AbortSignal) {
  const [ps, env] = await Promise.all([
    capture('/bin/ps', ['-axo', 'pid=,ppid=,command='], signal),
    capture('/bin/ps', ['-E', '-axo', 'pid=,command='], signal),
  ]);
  const procs = parsePs(ps);
  // An empty table means ps failed, not that nothing runs: the hibernate gate must not read it as idle.
  if (procs.length === 0) throw new Error('ps returned no processes');
  return { procs, trees: providerTrees(procs, parseThreadIds(env)) };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    sample: async (_input, { signal }): Promise<Sample> => {
      const [cpuPct, memory, dsk, bat, sh, rb] = await Promise.all([
        softly(cpu()),
        platform === 'darwin' ? softly(darwinMemory(signal))
          : platform === 'linux' ? softly(text('/proc/meminfo').then(info => ({ raw: null, ram: parseMeminfo(info ?? '') })))
          : null,
        disk(), softly(battery(signal)), softly(ssh(signal)), softly(reboot()),
      ]);
      const uptime = soft(os.uptime);
      return {
        vitals: {
          hostname: os.hostname(), platform, arch: os.arch(), uptimeSec: uptime === null ? null : Math.round(uptime),
          cores: soft(() => os.cpus().length) ?? 0, load1: soft(() => os.loadavg()[0]) ?? 0,
          cpuPct, memory: memory?.ram ?? null, disk: dsk, battery: bat, ssh: sh, reboot: rb,
          sampledAt: Date.now(),
        },
        memory: memory?.raw ?? null,
      };
    },
    triage: async (_input, { signal }) => {
      // ps -E and top -stats are macOS spellings; elsewhere they fail and would read as a missing process table.
      if (platform !== 'darwin') throw new Error('Memory triage reads macOS compressor counters; this machine has none.');
      // top reads phys_footprint for every process in one call (about 0.8 s), so RSS never picks the sample.
      const [{ raw }, { procs, trees }, top] = await Promise.all([
        darwinMemory(signal), readProcesses(signal), capture('/usr/bin/top', ['-l', '1', '-stats', 'pid,mem'], signal),
      ]);
      return { raw, ...triage(procs, trees, parseTopMem(top)) };
    },
    processes: async ({ threadIds }, { signal }) => {
      const { procs, trees } = await readProcesses(signal);
      return { threads: threadWork(trees, procs, threadIds) };
    },
    terminate: async ({ pid, command }, { signal }) => {
      const reason = terminateRefusal({ pid, command }, await readProcesses(signal), [process.pid, process.ppid]);
      if (reason) return { ok: false as const, reason };
      try {
        process.kill(pid, 'SIGTERM');
        return { ok: true as const };
      } catch (cause) {
        return { ok: false as const, reason: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  },
});
