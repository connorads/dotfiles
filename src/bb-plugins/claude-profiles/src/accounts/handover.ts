import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function stat(path: string) {
  return lstat(path).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
}
async function directory(path: string, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  });
  const value = await lstat(path);
  if (value.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
  if (!value.isDirectory()) throw new Error('Session path is not a directory.');
}
async function bytes(path: string) {
  const value = await lstat(path);
  if (value.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
  if (!value.isFile() || value.size > 64 * 1024 * 1024) throw new Error('Unsupported session file.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size > 64 * 1024 * 1024) throw new Error('Unsupported session file.');
    return await file.readFile();
  } finally { await file.close(); }
}

type Snapshot = Map<string, Buffer | null>;
async function snapshot(project: string, sessionId: string): Promise<Snapshot> {
  const result: Snapshot = new Map();
  let size = 0;
  async function visit(path: string) {
    if (result.size >= 4096) throw new Error('Session has too many files or directories.');
    const full = join(project, path);
    const value = await lstat(full);
    if (value.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
    if (value.isDirectory()) {
      result.set(path, null);
      for (const entry of (await readdir(full)).sort()) await visit(join(path, entry));
    } else {
      const content = await bytes(full);
      size += content.length;
      if (size > 256 * 1024 * 1024) throw new Error('Session exceeds the transfer size limit.');
      result.set(path, content);
    }
  }
  if (await stat(join(project, `${sessionId}.jsonl`))) await visit(`${sessionId}.jsonl`);
  if (await stat(join(project, sessionId))) {
    await directory(join(project, sessionId));
    await visit(sessionId);
  }
  return result;
}
function equal(left: Snapshot, right: Snapshot) {
  return left.size === right.size && [...left].every(([path, content]) => {
    const other = right.get(path);
    return content === null ? other === null : other !== null && other !== undefined && content.equals(other);
  });
}
function changes(source: Snapshot, target: Snapshot) {
  for (const [path, previous] of target) {
    const content = source.get(path);
    if (content === undefined || (previous === null) !== (content === null)) {
      throw new Error(`Target history has diverged at ${path}. It was not overwritten.`);
    }
    if (previous !== null && content !== null && !previous.equals(content)) {
      const extendsLog = path.endsWith('.jsonl') &&
        (previous.length === 0 || previous[previous.length - 1] === 10) &&
        content.subarray(0, previous.length).equals(previous);
      if (!extendsLog) throw new Error(`Target history has diverged at ${path}. It was not overwritten.`);
    }
  }
  return [...source].filter(([path, content]) => {
    const previous = target.get(path);
    return content !== null && (previous === undefined || previous === null || !content.equals(previous));
  });
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
    const value = await stat(join(projects, entry.name, `${sessionId}.jsonl`));
    if (value?.isSymbolicLink()) throw new Error('Refusing a symlink transcript.');
    if (value?.isFile()) matches.push(entry.name);
  }
  const project = matches[0];
  if (matches.length !== 1 || !project) throw new Error('Native session not found uniquely in the current profile.');
  const sourceProject = join(projects, project);
  await directory(sourceProject);
  const content = await snapshot(sourceProject, sessionId);
  const main = `${sessionId}.jsonl`;
  if (!Buffer.isBuffer(content.get(main))) throw new Error('Source history changed during the switch.');
  await directory(join(target, 'projects'), true);
  const targetProject = join(target, 'projects', project);
  await directory(targetProject, true);
  const previous = await snapshot(targetProject, sessionId);
  const pending = changes(content, previous);
  const temporary = join(targetProject, `.${sessionId}-${randomUUID()}.tmp`);
  await directory(temporary, true);
  const staged: string[] = [];
  const folders = [...content].filter(([, value]) => value === null).map(([path]) => path);
  const created: string[] = [];
  try {
    for (const path of folders) { await directory(join(temporary, path), true); created.push(path); }
    for (const [path, value] of pending) {
      if (value === null) continue;
      const file = await open(join(temporary, path), 'wx', 0o600);
      staged.push(path);
      try { await file.writeFile(value); await file.sync(); }
      finally { await file.close(); }
    }
    if (!equal(content, await snapshot(sourceProject, sessionId))) {
      throw new Error('Source history changed during the switch. Try again when idle.');
    }
    if (!equal(previous, await snapshot(targetProject, sessionId))) {
      throw new Error('Target history changed during the switch.');
    }
    for (const path of folders) await directory(join(targetProject, path), true);
    // Publish the parent after every child file. A failed copy can be retried.
    for (const [path] of pending.sort(([a], [b]) => Number(a === main) - Number(b === main))) {
      if (path === main) {
        if (!equal(content, await snapshot(sourceProject, sessionId))) {
          throw new Error('Source history changed during the switch. Try again when idle.');
        }
        const ready = new Map(content);
        const parent = previous.get(main);
        if (parent === undefined) ready.delete(main);
        else ready.set(main, parent);
        if (!equal(ready, await snapshot(targetProject, sessionId))) {
          throw new Error('Target history changed during the switch.');
        }
      }
      await directory(dirname(join(targetProject, path)));
      const current = await stat(join(targetProject, path));
      const expected = previous.get(path);
      if (current?.isSymbolicLink() || (expected === undefined ? current !== null :
        !current || expected === null || !(await bytes(join(targetProject, path))).equals(expected))) {
        throw new Error('Target history changed during the switch.');
      }
      await rename(join(temporary, path), join(targetProject, path));
    }
  } finally {
    for (const path of staged) await unlink(join(temporary, path)).catch(error => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
    for (const path of [...created].reverse()) await rmdir(join(temporary, path));
    await rmdir(temporary);
  }
}
