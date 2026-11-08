import type { Proc } from './parse.ts';
import { processOwners, type AppProcess, type ProviderTree } from './triage.ts';

export interface ProcessTime { started: string; ageSec: number }
export interface Service {
  rootPid: number; name: string; cwd: string | null; listeners: string[];
  ageSec: number | null; mb: number; evidence: string; processes: AppProcess[];
}

export function parseProcessTimes(text: string): Map<number, ProcessTime> {
  const result = new Map<number, ProcessTime>();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/);
    if (!match) continue;
    result.set(Number(match[1]), { started: match[2]!.replace(/\s+/g, ' '),
      ageSec: Number(match[3] ?? 0) * 86400 + Number(match[4] ?? 0) * 3600 + Number(match[5]) * 60 + Number(match[6]) });
  }
  return result;
}

/** lsof -F pn: retain only the names under each process record. */
export function parseLsofFields(text: string): Map<number, string[]> {
  const result = new Map<number, string[]>();
  let pid: number | null = null;
  for (const line of text.split('\n')) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    else if (pid !== null && line.startsWith('n')) result.set(pid, [...new Set([...(result.get(pid) ?? []), line.slice(1)])]);
  }
  return result;
}

export function identityRefusal(expected: string | null, current: string | null): string | null {
  if (!expected || !current) return 'Cannot verify this process start time. Refresh and try again.';
  return expected === current ? null : 'The process start time changed. Refresh and try again.';
}

function serviceName(command: string): string | null {
  if (/^(?:\S*\/)?(?:zsh|bash|sh)\s+-c\s/.test(command)) return null;
  if (/ms-playwright|playwright.*(?:webkit|chromium|firefox)|headless_shell/.test(command)) return 'Browser automation';
  if (/(?:^|[\s/])vite(?:[\s/]|$)/.test(command)) return 'Vite';
  if (/(?:^|[\s/])next(?:[\s/]).*\b(?:dev|start)\b/.test(command)) return 'Next.js';
  if (/\bhttp\.server\b/.test(command)) return 'Python server';
  if (/(?:^|[\s/])(?:wrangler|workerd)(?:[\s/]|$)/.test(command)) return 'Worker';
  return null;
}

/** Independent roots stay separate even when their working directories match. */
export function developmentServices(procs: Proc[], trees: ProviderTree[], { footprints, times, directories, listeners }: {
    footprints: Map<number, number>; times: Map<number, ProcessTime>;
    directories: Map<number, string[]>; listeners: Map<number, string[]>;
  }): Service[] {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const names = new Map(procs.flatMap(p => { const name = serviceName(p.command); return name ? [[p.pid, name] as const] : []; }));
  const owners = processOwners(procs, trees);
  const groups = new Map<number, Proc[]>();
  for (const proc of procs) {
    let current: Proc | undefined = proc;
    let root: number | null = null;
    const seen = new Set<number>();
    while (current && !seen.has(current.pid)) {
      seen.add(current.pid);
      if (names.has(current.pid)) root = current.pid;
      current = byPid.get(current.ppid);
    }
    if (root !== null) groups.set(root, [...(groups.get(root) ?? []), proc]);
  }
  return [...groups].map(([rootPid, members]): Service => {
    const root = byPid.get(rootPid)!;
    const processes = members.map((p): AppProcess => ({ pid: p.pid, command: p.command.slice(0, 240),
      started: times.get(p.pid)?.started ?? null, mb: footprints.get(p.pid) ?? 0, owner: owners.get(p.pid) ?? null }));
    const protectedWork = processes.some(p => p.owner !== null);
    return { rootPid, name: names.get(rootPid)!, cwd: directories.get(rootPid)?.[0] ?? null,
      listeners: [...new Set(members.flatMap(p => listeners.get(p.pid) ?? []))],
      ageSec: times.get(rootPid)?.ageSec ?? null, mb: processes.reduce((sum, p) => sum + p.mb, 0),
      evidence: protectedWork ? 'Owned by a BB provider' : root.ppid === 1 ? 'Parent exited; owner unknown' : 'Owner unknown; check running work',
      processes };
  }).sort((a, b) => b.mb - a.mb || (b.ageSec ?? 0) - (a.ageSec ?? 0));
}
