import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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
async function* chunks(path: string, limit = Infinity) {
  const value = await lstat(path);
  if (value.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
  if (!value.isFile()) throw new Error('Unsupported session file.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error('Unsupported session file.');
    const buffer = Buffer.alloc(64 * 1024);
    let remaining = limit;
    while (remaining > 0) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead === 0) break;
      remaining -= bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
  } finally { await file.close(); }
}
type Fingerprint = { size: number; hash: string; lastByte: number | undefined };
async function fingerprint(path: string, limit = Infinity): Promise<Fingerprint> {
  const hash = createHash('sha256');
  let size = 0;
  let lastByte: number | undefined;
  for await (const chunk of chunks(path, limit)) {
    hash.update(chunk);
    size += chunk.length;
    lastByte = chunk[chunk.length - 1];
  }
  return { size, hash: hash.digest('hex'), lastByte };
}
function same(left: Fingerprint, right: Fingerprint) {
  return left.size === right.size && left.hash === right.hash;
}
type Snapshot = Map<string, Fingerprint | null>;
async function snapshot(project: string, sessionId: string): Promise<Snapshot> {
  const result: Snapshot = new Map();
  async function visit(path: string) {
    if (result.size >= 4096) throw new Error('Session has too many files or directories.');
    const full = join(project, path);
    const value = await lstat(full);
    if (value.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
    if (value.isDirectory()) {
      result.set(path, null);
      for (const entry of (await readdir(full)).sort()) await visit(join(path, entry));
    } else {
      result.set(path, await fingerprint(full));
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
    return content === null ? other === null : other !== null && other !== undefined && same(content, other);
  });
}
/** The source paths to copy, or null when the target holds history the source lacks. */
async function changes(source: Snapshot, target: Snapshot, sourceProject: string, sessionId: string) {
  // Claude rewrites workflow state files whole. The loop below proves the source parent log extends the
  // target's, so a strictly longer one means the source holds every target turn and its state is newer.
  const sourceMain = source.get(`${sessionId}.jsonl`);
  const targetMain = target.get(`${sessionId}.jsonl`);
  const advanced = !!sourceMain && !!targetMain && sourceMain.size > targetMain.size;
  const workflowState = new RegExp(`^${sessionId}/workflows/[^/]+\\.json$`);
  for (const [path, previous] of target) {
    const content = source.get(path);
    if (content === undefined || (previous === null) !== (content === null)) {
      return null;
    }
    if (previous !== null && content !== null && !same(previous, content)) {
      const extendsLog = path.endsWith('.jsonl') &&
        previous.size <= content.size &&
        (previous.size === 0 || previous.lastByte === 10) &&
        same(await fingerprint(join(sourceProject, path), previous.size), previous);
      if (!extendsLog && !(advanced && workflowState.test(path))) return null;
    }
  }
  return [...source].filter(([path, content]) => {
    const previous = target.get(path);
    return content !== null && (previous === undefined || previous === null || !same(content, previous));
  });
}

const sessionIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
async function findSessionProjects(profile: string, sessionId: string, allowMissingProjects = false) {
  if (!sessionIdPattern.test(sessionId)) throw new Error('Invalid native session ID.');
  await directory(profile);
  const projects = join(profile, 'projects');
  if (allowMissingProjects && !(await stat(projects))) return [];
  await directory(projects);
  const matches: string[] = [];
  for (const entry of await readdir(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const value = await stat(join(projects, entry.name, `${sessionId}.jsonl`));
    if (value?.isSymbolicLink()) throw new Error('Refusing a symlink transcript.');
    if (value?.isFile()) matches.push(entry.name);
  }
  return matches;
}
export async function hasSession(profile: string, sessionId: string): Promise<boolean> {
  return (await findSessionProjects(profile, sessionId, true)).length === 1;
}

export type CopySummary = { prompts: number; modifiedAt: string; lastPrompt: string | null };
export type Transfer = { status: 'copied' } | { status: 'diverged'; source: CopySummary; target: CopySummary };

function promptText(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const value = record as { type?: unknown; isMeta?: unknown; message?: { content?: unknown } };
  if (value.type !== 'user' || value.isMeta === true) return null;
  const content = value.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content.find((part): part is { type: 'text'; text: string } =>
    !!part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string');
  return text?.text ?? null;
}
/** Enough of a copy for the user to tell two histories apart. */
async function summarise(project: string, sessionId: string): Promise<CopySummary> {
  const path = join(project, `${sessionId}.jsonl`);
  const value = await stat(path);
  if (!value?.isFile()) return { prompts: 0, modifiedAt: new Date(0).toISOString(), lastPrompt: null };
  let prompts = 0;
  let lastPrompt: string | null = null;
  let rest = '';
  const read = (line: string) => {
    let text: string | null = null;
    try { text = promptText(JSON.parse(line)); } catch { /* A torn final line from a live writer is skipped. */ }
    if (text === null) return;
    prompts += 1;
    lastPrompt = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  const decoder = new TextDecoder();
  for await (const chunk of chunks(path)) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
    rest = lines.pop() ?? '';
    lines.forEach(read);
  }
  read(rest + decoder.decode());
  return { prompts, modifiedAt: value.mtime.toISOString(), lastPrompt };
}

/**
 * Moves the target's copy of a session aside, under `replaced-history/`, so a transfer can take its place.
 * Claude Code never reads that folder, and the user can restore from it by hand.
 */
async function setAside(target: string, project: string, sessionId: string, now: Date) {
  const targetProject = join(target, 'projects', project);
  const archive = join(target, 'replaced-history', project, `${sessionId}-${now.toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(archive, { recursive: true, mode: 0o700 });
  for (const name of [`${sessionId}.jsonl`, sessionId]) {
    const value = await stat(join(targetProject, name));
    if (value?.isSymbolicLink()) throw new Error('Refusing a symlink in session paths.');
    if (value) await rename(join(targetProject, name), join(archive, name));
  }
}

/**
 * Only this session's history crosses profiles. A target copy with history the source lacks is reported
 * as diverged and kept, unless `replace` moves it aside first.
 */
export async function transferSession(source: string, target: string, sessionId: string,
  options: { replace?: boolean; allowMissing?: boolean; now?: Date } = {}): Promise<Transfer> {
  if (!sessionIdPattern.test(sessionId)) throw new Error('Invalid native session ID.');
  if (source === target) return { status: 'copied' };
  const matches = await findSessionProjects(source, sessionId, Boolean(options.allowMissing));
  await directory(target);
  if (matches.length === 0) {
    if (await hasSession(target, sessionId) || options.allowMissing) return { status: 'copied' };
    throw new Error('Native session not found uniquely in the current profile.');
  }
  const project = matches[0];
  if (matches.length !== 1 || !project) throw new Error('Native session not found uniquely in the current profile.');
  await directory(join(source, 'projects', project));
  const sourceProject = join(source, 'projects', project);
  const content = await snapshot(sourceProject, sessionId);
  const main = `${sessionId}.jsonl`;
  if (!content.get(main)) throw new Error('Source history changed during the switch.');
  await directory(join(target, 'projects'), true);
  const targetProject = join(target, 'projects', project);
  await directory(targetProject, true);
  let previous = await snapshot(targetProject, sessionId);
  let pending = await changes(content, previous, sourceProject, sessionId);
  if (!pending && options.replace) {
    await setAside(target, project, sessionId, options.now ?? new Date());
    previous = await snapshot(targetProject, sessionId);
    pending = await changes(content, previous, sourceProject, sessionId);
  }
  if (!pending) {
    return { status: 'diverged', source: await summarise(sourceProject, sessionId), target: await summarise(targetProject, sessionId) };
  }
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
      try {
        for await (const chunk of chunks(join(sourceProject, path))) await file.writeFile(chunk);
        await file.sync();
      } finally { await file.close(); }
      if (!same(value, await fingerprint(join(temporary, path)))) {
        throw new Error('Source history changed during the switch. Try again when idle.');
      }
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
        !current || expected === null || !same(await fingerprint(join(targetProject, path)), expected))) {
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
  return { status: 'copied' };
}

/**
 * Removes the source profile's copy once the target holds every source file unchanged, so each
 * session keeps one live copy. A source that differs from the target is left in place.
 */
export async function releaseSession(source: string, target: string, sessionId: string): Promise<{ released: boolean }> {
  if (!sessionIdPattern.test(sessionId)) throw new Error('Invalid native session ID.');
  if (source === target) return { released: false };
  const matches = await findSessionProjects(source, sessionId, true);
  if (matches.length === 0) return { released: false };
  const project = matches[0];
  if (matches.length !== 1 || !project) throw new Error('Native session not found uniquely in the current profile.');
  await directory(join(source, 'projects', project));
  const sourceProject = join(source, 'projects', project);
  const targetProject = join(target, 'projects', project);
  const content = await snapshot(sourceProject, sessionId);
  await directory(targetProject);
  const copy = await snapshot(targetProject, sessionId);
  const held = [...content].every(([path, value]) => {
    const other = copy.get(path);
    return value === null ? other === null : !!other && same(value, other);
  });
  if (!held) return { released: false };
  // The transcript goes first: without it Claude Code no longer lists the session, even if a later unlink fails.
  const files = [...content].filter(([, value]) => value !== null).map(([path]) => path)
    .sort((a, b) => Number(b === `${sessionId}.jsonl`) - Number(a === `${sessionId}.jsonl`));
  for (const path of files) await unlink(join(sourceProject, path));
  const folders = [...content].filter(([, value]) => value === null).map(([path]) => path);
  for (const path of folders.sort((a, b) => b.length - a.length)) await rmdir(join(sourceProject, path));
  return { released: true };
}
