import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

export type ProfileDir = { id: string; dir: string };
export type Located = { profileId: string; sessionId: string; cwd: string; title: string };
type Live = { sessionId: string; cwd: string; name: string | null; status: string | null };

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const isSessionId = (value: string) => uuid.test(value);

async function exists(path: string) {
  return lstat(path).then(value => value, error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
}
async function readText(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await file.stat()).size > 64 * 1024 * 1024) throw new Error('Unsupported session file.');
    return await file.readFile();
  } finally { await file.close(); }
}

/** The one project directory in one profile that holds this session's transcript. */
async function transcript(profiles: ProfileDir[], sessionId: string) {
  const matches: { profile: ProfileDir; project: string }[] = [];
  for (const profile of profiles) {
    const projects = join(profile.dir, 'projects');
    if (!(await exists(projects))?.isDirectory()) continue;
    for (const entry of await readdir(projects, { withFileTypes: true })) {
      if (entry.isDirectory() && (await exists(join(projects, entry.name, `${sessionId}.jsonl`)))?.isFile()) {
        matches.push({ profile, project: join(projects, entry.name) });
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(matches.length ? `Session ${sessionId} exists in more than one profile or project.` : `Session ${sessionId} was not found.`);
  }
  return matches[0]!;
}

function summary(lines: string[]) {
  let cwd: string | null = null;
  let title: string | null = null;
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as { cwd?: unknown; type?: unknown; aiTitle?: unknown };
      if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
      if (record.type === 'ai-title' && typeof record.aiTitle === 'string') title = record.aiTitle;
    } catch { /* A torn final line from a live writer is skipped. */ }
  }
  return { cwd, title };
}

export async function locateSession(profiles: ProfileDir[], sessionId: string, live?: Live): Promise<Located> {
  if (!isSessionId(sessionId)) throw new Error('Invalid native session ID.');
  const { profile, project } = await transcript(profiles, sessionId);
  const { cwd, title } = summary((await readText(join(project, `${sessionId}.jsonl`))).toString('utf8').split('\n'));
  const directory = live?.cwd ?? cwd;
  if (!directory) throw new Error(`Session ${sessionId} records no working directory.`);
  return { profileId: profile.id, sessionId, cwd: directory, title: title ?? live?.name ?? sessionId.slice(0, 8) };
}

/** Claude Code writes `sessions/<pid>.json` for each interactive process. */
export async function liveSession(profiles: ProfileDir[], pids: number[]): Promise<Live & { profileId: string }> {
  const found: (Live & { profileId: string })[] = [];
  for (const profile of profiles) {
    for (const pid of pids) {
      const path = join(profile.dir, 'sessions', `${pid}.json`);
      if (!(await exists(path))?.isFile()) continue;
      const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      if (typeof value.sessionId !== 'string' || typeof value.cwd !== 'string') continue;
      found.push({ profileId: profile.id, sessionId: value.sessionId, cwd: value.cwd,
        name: typeof value.name === 'string' ? value.name : null, status: typeof value.status === 'string' ? value.status : null });
    }
  }
  if (found.length !== 1) throw new Error(found.length ? 'More than one Claude session runs in this pane.' : 'No Claude session runs in this pane.');
  return found[0]!;
}

/** The pane's shell and every process below it, from `ps -A -o pid=,ppid=` output. */
export function descendants(root: number, table: string) {
  const children = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid !== undefined) children.set(ppid, [...children.get(ppid) ?? [], pid]);
  }
  const result: number[] = [];
  for (const queue = [root]; queue.length;) {
    const pid = queue.shift()!;
    result.push(pid);
    queue.push(...children.get(pid) ?? []);
  }
  return result;
}
export async function paneSession(profiles: ProfileDir[], pane: string) {
  const run = promisify(execFile);
  const { stdout } = await run('tmux', ['display-message', '-p', '-t', pane, '#{pane_pid}']).catch(() => {
    throw new Error(`tmux pane ${pane} was not found.`);
  });
  const { stdout: table } = await run('ps', ['-A', '-o', 'pid=,ppid=']);
  const live = await liveSession(profiles, descendants(Number(stdout.trim()), table));
  if (live.status !== 'idle') throw new Error(`The Claude session in ${pane} is ${live.status ?? 'busy'}. Wait until it is idle.`);
  return locateSession(profiles.filter(profile => profile.id === live.profileId), live.sessionId, live);
}

function replace(content: Buffer, from: string, to: string) {
  const needle = Buffer.from(from);
  const parts: Buffer[] = [];
  let start = 0;
  for (let index = content.indexOf(needle); index !== -1; index = content.indexOf(needle, start)) {
    parts.push(content.subarray(start, index), Buffer.from(to));
    start = index + needle.length;
  }
  parts.push(content.subarray(start));
  return Buffer.concat(parts);
}
async function copyTree(source: string, target: string, from: string, to: string) {
  await mkdir(target, { mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
    const name = entry.name.replaceAll(from, to);
    if (entry.isDirectory()) await copyTree(join(source, entry.name), join(target, name), from, to);
    else if (entry.isFile()) {
      const file = await open(join(target, name), 'wx', 0o600);
      try { await file.writeFile(replace(await readText(join(source, entry.name)), from, to)); await file.sync(); }
      finally { await file.close(); }
    }
  }
}

/**
 * Replace a fresh thread's transcript with another session's history, so `--resume <target>` continues it.
 * The source is only read. Session IDs inside the copy are rewritten to the target.
 */
export async function adoptSession(configDir: string, sourceId: string, targetId: string): Promise<void> {
  if (!isSessionId(sourceId) || !isSessionId(targetId)) throw new Error('Invalid native session ID.');
  if (sourceId === targetId) throw new Error('A session cannot adopt itself.');
  const profile = { id: 'target', dir: configDir };
  const { project } = await transcript([profile], sourceId);
  const main = join(project, `${targetId}.jsonl`);
  if (!(await exists(main))?.isFile()) throw new Error('The new thread runs in another directory than the source session.');
  const folder = join(project, targetId);
  if (await exists(folder)) throw new Error('The new thread already has session files. It was not overwritten.');
  const staged = join(project, `.${targetId}-${randomUUID()}.tmp`);
  try {
    if ((await exists(join(project, sourceId)))?.isDirectory()) {
      await copyTree(join(project, sourceId), staged, sourceId, targetId);
      await rename(staged, folder);
    }
    // Publish the transcript after its files, as transferSession does.
    const file = await open(staged, 'wx', 0o600);
    try { await file.writeFile(replace(await readText(join(project, `${sourceId}.jsonl`)), sourceId, targetId)); await file.sync(); }
    finally { await file.close(); }
    await rename(staged, main);
  } finally { await rm(staged, { recursive: true, force: true }); }
}
