import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const exec = promisify(execFile);
export async function command(binary: string, args: string[], cwd?: string): Promise<string> {
  try {
    const result = await exec(binary, args, {
      cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    });
    return result.stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${binary} ${args.slice(0, 2).join(' ')} failed: ${detail.slice(0, 1200)}`);
  }
}
const id = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const task = z.object({
  id, projectId: id, name: z.string().min(1), enabled: z.boolean(),
  trigger: z.object({ triggerType: z.enum(['schedule', 'once']) }).catchall(z.json()),
  execution: z.object({ mode: z.enum(['agent', 'script']) }).catchall(z.json()),
  problem: z.never().optional(),
});
const project = z.object({ id, name: z.string(), automations: z.array(task) });
export function makeSnapshot(input: unknown) {
  const projects = z.array(project).parse(input);
  const ids = new Set<string>();
  for (const entry of projects) {
    for (const automation of entry.automations) {
      if (automation.projectId !== entry.id || ids.has(automation.id)) throw new Error('Invalid automation ownership or duplicate ID');
      ids.add(automation.id);
      if (automation.execution.mode === 'agent' && typeof automation.execution.prompt !== 'string') throw new Error(`Missing prompt for ${automation.id}`);
      if (automation.execution.mode === 'script' && typeof automation.execution.script !== 'string') throw new Error(`Missing script for ${automation.id}`);
    }
  }
  return {
    schemaVersion: 1,
    projects: projects.map(({ id: projectId, name }) => ({ id: projectId, name })).sort((a, b) => a.id.localeCompare(b.id)),
    automations: projects.flatMap(entry => entry.automations.map(({ problem: _problem, ...definition }) => definition)).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export type Snapshot = ReturnType<typeof makeSnapshot>;
function ordered(value: z.infer<ReturnType<typeof z.json>>): z.infer<ReturnType<typeof z.json>> {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export function serialise(value: unknown) { return `${JSON.stringify(ordered(z.json().parse(value)), null, 2)}\n`; }
function hasCode(error: unknown, code: string) { return error instanceof Error && 'code' in error && error.code === code; }
export type BackupSource = {
  read(): Promise<Snapshot>;
  verifyRemote(origin: string): Promise<void>;
};

export async function backup(directory: string, source: BackupSource) {
  const repo = await realpath(directory);
  const git = async (...args: string[]) => (await command('git', args, repo)).trim();
  if (await realpath(await git('rev-parse', '--show-toplevel')) !== repo) throw new Error('Backup path must be a dedicated Git checkout');
  if (await git('symbolic-ref', 'HEAD') !== 'refs/heads/main') throw new Error('Backup checkout must use main');
  const lock = join(await git('rev-parse', '--absolute-git-dir'), 'automation-backup.lock');
  try { await mkdir(lock); }
  catch (error) { if (hasCode(error, 'EEXIST')) throw new Error('Another backup writer holds the checkout lock'); throw error; }
  try {
    if (await git('status', '--porcelain')) throw new Error('Backup checkout must be clean; existing changes remain intact');
    const origins = (await git('remote', 'get-url', '--push', '--all', 'origin')).split('\n');
    if (origins.length !== 1) throw new Error('Backup origin must have exactly one push destination');
    await source.verifyRemote(origins[0]);
    const snapshot = await source.read();
    const content = serialise(snapshot);
    const path = join(repo, 'automations.json');
    let previous = '';
    try { previous = await readFile(path, 'utf8'); }
    catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
    const changed = previous !== content;
    if (changed) {
      const temporary = join(repo, `.automation-backup-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(error => { if (!hasCode(error, 'ENOENT')) throw error; });
      }
      await git('add', '--', 'automations.json');
      await git('commit', '-m', `backup: ${snapshot.automations.length} automation definitions`, '--', 'automations.json');
    }
    await git('push', 'origin', 'HEAD:refs/heads/main');
    return { changed, automations: snapshot.automations.length, commit: await git('rev-parse', 'HEAD'), pushed: true };
  } finally { await rmdir(lock); }
}
