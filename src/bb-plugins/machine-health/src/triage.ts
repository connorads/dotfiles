// Who holds the memory: apps by phys_footprint, and bb threads by the
// footprint of their provider process tree. Pure over captured process tables.
import { appName, type Proc } from './parse.ts';

/** The bb worker that spawns one provider process per Claude thread. */
const bridgeWorker = 'bb-provider-bridge-worker';
/** Every bb process, server, helpers and workers, runs from the app bundle. */
const bbBundle = '/bb.app/';
const commandCap = 240;
const workCap = 100;
/** How many apps the dialog receives, and how many processes under each. */
export const appLimit = 15;
export const processLimit = 10;

export interface ProviderTree { threadId: string; rootPid: number; pids: number[] }
/** A live descendant of a provider process: a tool call, hook or build the thread still owns. */
export interface Work { command: string; processes: number }
/**
 * Who keeps the process from an End: `thread` is part of a bb thread's provider
 * tree; `bb` is bb itself or recognised provider infrastructure. Null may be ended.
 */
export type Owner = 'thread' | 'bb' | null;
export interface AppProcess { pid: number; mb: number; command: string; owner: Owner }
export interface AppGroup { app: string; mb: number; count: number; processes: AppProcess[] }
export interface ThreadUsage { threadId: string; rootPid: number; mb: number; processes: number; work: Work | null }
export interface Triage { apps: AppGroup[]; threads: ThreadUsage[] }

function children(procs: Proc[]) {
  const map = new Map<number, number[]>();
  for (const proc of procs) map.set(proc.ppid, [...(map.get(proc.ppid) ?? []), proc.pid]);
  return map;
}

/** The root first, then its descendants breadth-first. */
function descendants(root: number, kids: Map<number, number[]>): number[] {
  const seen = new Set([root]);
  const queue = [root];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of kids.get(pid) ?? []) if (!seen.has(child)) { seen.add(child); queue.push(child); }
  }
  return [...seen];
}

/**
 * A provider root is a process carrying BB_THREAD_ID whose parent is the
 * provider bridge. Thread terminals inherit the same variable but hang off the
 * host daemon, and stopping the thread leaves them running, so they are not
 * counted. Its tree is what a stop ends: MCP servers and tool shells die with it.
 */
export function providerTrees(procs: Proc[], threadIds: Map<number, string>): ProviderTree[] {
  const byPid = new Map(procs.map(proc => [proc.pid, proc]));
  const kids = children(procs);
  const trees: ProviderTree[] = [];
  for (const proc of procs) {
    const threadId = threadIds.get(proc.pid);
    if (!threadId || !byPid.get(proc.ppid)?.command.includes(bridgeWorker)) continue;
    trees.push({ threadId, rootPid: proc.pid, pids: descendants(proc.pid, kids) });
  }
  return trees;
}

/**
 * Commands that name nothing useful: `zsh -c …` and friends wrap the real
 * command, and ps shows a just-forked process with no arguments yet as `(zsh)`.
 */
const unhelpful = /^(?:(?:\S*\/)?(?:zsh|bash|sh|dash|fish)\s+-c\s|\(.*\)$)/;

/**
 * What a provider process still runs. bb can report a thread idle while its
 * process owns live work: a commit hook running a 1.9 GB `nix eval` under an
 * idle thread was seen live, and a stop would have killed the commit. Names
 * the first descendant with a useful command, so the reason reads
 * `git commit …` rather than the shell that launched it.
 */
export function liveWork(tree: ProviderTree, procs: Proc[]): Work | null {
  const byPid = new Map(procs.map(proc => [proc.pid, proc]));
  const live = tree.pids.filter(pid => pid !== tree.rootPid).flatMap(pid => byPid.get(pid) ?? []);
  if (live.length === 0) return null;
  const named = live.find(proc => !unhelpful.test(proc.command)) ?? live[0]!;
  return { command: named.command.slice(0, workCap), processes: live.length };
}

/**
 * The live work of each listed thread that has a provider process here. A
 * thread with two provider processes (a restart that overlaps the old one)
 * reports work if either tree has any, so the gate never reads it as idle.
 */
export function threadWork(trees: ProviderTree[], procs: Proc[], threadIds: string[]): { threadId: string; work: Work | null }[] {
  const wanted = new Set(threadIds);
  const work = new Map<string, Work | null>();
  for (const tree of trees) {
    if (wanted.has(tree.threadId) && !work.get(tree.threadId)) work.set(tree.threadId, liveWork(tree, procs));
  }
  return [...work].map(([threadId, found]) => ({ threadId, work: found }));
}

/** Codex servers can outlive thread attribution, including the managed daemon. */
const codexServer = /^(?:\S*\/)?codex\s+app-server(?:\s|$)/;

function infrastructurePids(procs: Proc[]): Set<number> {
  const kids = children(procs);
  return new Set(procs
    .filter(proc => proc.command.includes(bridgeWorker) || codexServer.test(proc.command))
    .flatMap(proc => descendants(proc.pid, kids)));
}

const ownerOf = (proc: Proc, threadPids: Set<number>, infrastructure: Set<number>): Owner =>
  threadPids.has(proc.pid) ? 'thread'
    : infrastructure.has(proc.pid) || proc.command.includes(bbBundle) ? 'bb' : null;

/**
 * Apps grouped by bundle and ranked by summed footprint; threads ranked by
 * their tree's footprint. Sums over-count shared pages, so the ranking is
 * reliable and the totals approximate.
 */
export function triage(procs: Proc[], trees: ProviderTree[], footprints: Map<number, number>): Triage {
  const groups = new Map<string, AppGroup>();
  const threadPids = new Set(trees.flatMap(tree => tree.pids));
  const infrastructure = infrastructurePids(procs);
  for (const proc of procs) {
    const mb = footprints.get(proc.pid) ?? 0;
    if (mb <= 0) continue;
    const app = appName(proc.command);
    const group = groups.get(app) ?? { app, mb: 0, count: 0, processes: [] };
    group.mb += mb;
    group.count += 1;
    group.processes.push({ pid: proc.pid, mb, command: proc.command.slice(0, commandCap), owner: ownerOf(proc, threadPids, infrastructure) });
    groups.set(app, group);
  }
  const apps = [...groups.values()].sort((a, b) => b.mb - a.mb).slice(0, appLimit);
  for (const group of apps) group.processes = group.processes.sort((a, b) => b.mb - a.mb).slice(0, processLimit);
  const threads = trees
    .map(tree => ({ threadId: tree.threadId, rootPid: tree.rootPid, processes: tree.pids.length,
      mb: tree.pids.reduce((sum, pid) => sum + (footprints.get(pid) ?? 0), 0), work: liveWork(tree, procs) }))
    .sort((a, b) => b.mb - a.mb);
  return { apps, threads };
}

/**
 * Why the host refuses to signal a pid, or null when it may. The pid must
 * still run the command the user saw (pid reuse), and provider processes go
 * through a thread stop so bb records the session as stopped.
 */
export function terminateRefusal({ pid, command: expectedCommand }: { pid: number; command: string },
  { procs, trees }: { procs: Proc[]; trees: ProviderTree[] }, ownPids: number[]): string | null {
  if (pid <= 1 || ownPids.includes(pid)) return 'That process cannot be ended from here.';
  const current = procs.find(proc => proc.pid === pid);
  if (!current) return 'The process has already exited.';
  if (current.command.slice(0, commandCap) !== expectedCommand) return 'The pid now belongs to a different process. Refresh and try again.';
  const owner = ownerOf(current, new Set(trees.flatMap(tree => tree.pids)), infrastructurePids(procs));
  if (owner === 'thread') return 'This process belongs to a bb thread. Stop the thread instead.';
  if (owner === 'bb') return 'This process is part of bb or its provider infrastructure.';
  return null;
}
