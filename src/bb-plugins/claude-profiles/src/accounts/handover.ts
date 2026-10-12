import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function directory(path: string, create = false) {
  if (create) await mkdir(path, { recursive: false }).catch(error => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  });
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
  if (!stat.isDirectory()) throw new Error('Session path is not a directory.');
}
async function bytes(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Unsupported transcript file.');
    return await file.readFile();
  } finally { await file.close(); }
}
/** Only this session's history crosses profiles. Existing divergent history is preserved. */
export async function transferSession(source: string, target: string, sessionId: string): Promise<void> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid native session ID.');
  if (source === target) return;
  await directory(source);
  await directory(target);
  const projects = join(source, 'projects');
  await directory(projects);
  const matches: string[] = [];
  for (const entry of await readdir(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(projects, entry.name, `${sessionId}.jsonl`);
    const stat = await lstat(file).catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error('Refusing a symlink transcript.');
    if (stat?.isFile()) matches.push(entry.name);
  }
  const project = matches[0];
  if (matches.length !== 1 || !project) throw new Error('Native session not found uniquely in the current profile.');
  const sourceProject = join(projects, project);
  await directory(sourceProject);
  // Sidecars contain subagent state. Refuse until their continuation is proven.
  const sidecar = await lstat(join(sourceProject, sessionId)).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (sidecar) throw new Error('This session has subagent files. Profile switching is not supported for it yet.');
  const sourceFile = join(sourceProject, `${sessionId}.jsonl`);
  const content = await bytes(sourceFile);
  await directory(join(target, 'projects'), true);
  const targetProject = join(target, 'projects', project);
  await directory(targetProject, true);
  const destination = join(targetProject, `${sessionId}.jsonl`);
  const stat = await lstat(destination).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat?.isSymbolicLink()) throw new Error('Refusing a symlink transcript.');
  const previous = stat ? await bytes(destination) : null;
  if (previous?.equals(content)) return;
  if (previous && !content.subarray(0, previous.length).equals(previous)) throw new Error('Target history has diverged. It was not overwritten.');
  const temporary = join(targetProject, `.${sessionId}-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally { await file.close(); }
  try {
    if (!(await bytes(sourceFile)).equals(content)) throw new Error('Source history changed during the switch. Try again when idle.');
    const current = await lstat(destination).catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    if (current?.isSymbolicLink() || Boolean(current) !== Boolean(stat) ||
        (previous && !(await bytes(destination)).equals(previous))) throw new Error('Target history changed during the switch.');
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
}
