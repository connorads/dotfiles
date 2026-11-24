import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hostContract } from './contracts.ts';
import { parseChunk, type Provider } from './src/records.ts';
import { readAgyWorkspaceCwd, readGeminiJsonFile, readGeminiProjectRoot, readGrokFile, readHermesDb, readOpenCodeDb } from './src/sources.ts';

const chunkBytes = 8 * 1024 * 1024;
const home = (path: string) => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
const agyTranscriptRe = /^(.+)\/brain\/([^/]+)\/\.system_generated\/logs\/transcript\.jsonl$/;

interface ListedFile { provider: Provider; path: string; size: number; mtimeMs: number; rewrite?: boolean }

/** Expand `~` and whole-segment `*` wildcards, such as `~/.claude-profiles/*\/*`. */
async function expand(pattern: string): Promise<string[]> {
  let paths = [pattern.startsWith('/') ? '/' : ''];
  for (const segment of home(pattern).split('/').filter(Boolean)) {
    if (segment !== '*') { paths = paths.map(path => join(path || '/', segment)); continue; }
    const next: string[] = [];
    for (const path of paths) {
      const entries = await readdir(path || '/', { withFileTypes: true }).catch(() => []);
      for (const entry of entries) if (entry.isDirectory()) next.push(join(path || '/', entry.name));
    }
    paths = next;
  }
  return paths;
}

async function jsonlRoots(claudeConfigDirs: readonly string[]): Promise<[Provider, string][]> {
  const codex = home(process.env.CODEX_HOME ?? '~/.codex');
  const claude = new Set([home(process.env.CLAUDE_CONFIG_DIR ?? '~/.claude')]);
  for (const pattern of claudeConfigDirs) for (const dir of await expand(pattern)) claude.add(dir);
  const pi = home(process.env.PI_CODING_AGENT_DIR ? join(process.env.PI_CODING_AGENT_DIR, 'sessions') : '~/.pi/agent/sessions');
  const omp = home(process.env.OMP_AGENT_DIR ? join(process.env.OMP_AGENT_DIR, 'sessions') : '~/.omp/agent/sessions');
  return [
    ...[...claude].map(dir => ['claude-code', join(dir, 'projects')] as [Provider, string]),
    ['codex', join(codex, 'sessions')], ['codex', join(codex, 'archived_sessions')],
    ['pi', pi],
    ['omp', omp],
  ];
}

async function walk(dir: string, since: number, found: (path: string, size: number, mtimeMs: number) => void) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, since, found);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs >= since) found(path, info.size, info.mtimeMs);
    }
  }
}

/** Stat a SQLite database together with its WAL file so WAL-only writes update size and mtime. */
async function statSqlite(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  const main = await stat(path).catch(() => null);
  if (!main?.isFile()) return null;
  const wal = await stat(`${path}-wal`).catch(() => null);
  return { size: main.size + (wal?.size ?? 0), mtimeMs: Math.max(main.mtimeMs, wal?.mtimeMs ?? 0) };
}

async function listAntigravity(since: number, add: (file: ListedFile) => void) {
  const agyRoots = [
    home('~/.gemini/antigravity-cli'),
    ...await expand('~/.local/share/agy-profiles/*/home/.gemini/antigravity-cli'),
  ];
  for (const root of agyRoots) {
    const brain = join(root, 'brain');
    const entries = await readdir(brain, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(brain, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.mtimeMs >= since) add({ provider: 'antigravity', path, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
}

async function listGeminiCli(since: number, add: (file: ListedFile) => void) {
  const tmp = home('~/.gemini/tmp');
  const projects = await readdir(tmp, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const chats = join(tmp, project.name, 'chats');
    const entries = await readdir(chats, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('session-')) continue;
      const isJsonl = entry.name.endsWith('.jsonl');
      const isJson = entry.name.endsWith('.json');
      if (!isJsonl && !isJson) continue;
      const path = join(chats, entry.name);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs >= since)
        add({ provider: 'gemini', path, size: info.size, mtimeMs: info.mtimeMs, ...(isJson ? { rewrite: true } : {}) });
    }
  }
}

async function listGrok(since: number, add: (file: ListedFile) => void) {
  const sessions = join(home(process.env.GROK_HOME ?? '~/.grok'), 'sessions');
  const folders = await readdir(sessions, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = join(sessions, folder.name);
    const ids = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const id of ids) {
      if (!id.isDirectory()) continue;
      const path = join(dir, id.name, 'usage.json');
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.mtimeMs >= since) add({ provider: 'grok', path, size: info.size, mtimeMs: info.mtimeMs, rewrite: true });
    }
  }
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    list: async ({ claudeConfigDirs, since }) => {
      const files: ListedFile[] = [];
      const seen = new Set<string>();
      const add = (file: ListedFile) => { if (!seen.has(file.path)) { seen.add(file.path); files.push(file); } };
      for (const [provider, root] of await jsonlRoots(claudeConfigDirs))
        await walk(root, since, (path, size, mtimeMs) => add({ provider, path, size, mtimeMs }));
      await listAntigravity(since, add);
      await listGeminiCli(since, add);
      await listGrok(since, add);
      const xdgData = process.env.XDG_DATA_HOME ? home(process.env.XDG_DATA_HOME) : home('~/.local/share');
      const opencodeDb = join(xdgData, 'opencode', 'opencode.db');
      const ocInfo = await statSqlite(opencodeDb);
      if (ocInfo && ocInfo.mtimeMs >= since) add({ provider: 'opencode', path: opencodeDb, size: ocInfo.size, mtimeMs: ocInfo.mtimeMs, rewrite: true });
      const hermesDb = join(home(process.env.HERMES_HOME ?? '~/.hermes'), 'state.db');
      const hermesInfo = await statSqlite(hermesDb);
      if (hermesInfo && hermesInfo.mtimeMs >= since) add({ provider: 'hermes', path: hermesDb, size: hermesInfo.size, mtimeMs: hermesInfo.mtimeMs, rewrite: true });
      return { files };
    },
    read: async ({ provider, path, offset, context, mtimeMs }) => {
      if (provider === 'opencode') {
        const result = readOpenCodeDb(path, context.sinceMs ?? 0);
        return { offset: 0, context: { ...context, mtimeMs, sinceMs: result.nextSinceMs ?? context.sinceMs },
          records: result.records, turns: result.turns, sessions: result.sessions };
      }
      if (provider === 'hermes') {
        const result = readHermesDb(path, context.sinceMs ?? 0);
        return { offset: 0, context: { ...context, mtimeMs, sinceMs: result.nextSinceMs ?? context.sinceMs },
          records: result.records, turns: result.turns, sessions: result.sessions };
      }
      if (provider === 'grok') {
        const result = await readGrokFile(path);
        return { offset: 0, context: { ...context, mtimeMs }, records: result.records, turns: result.turns, sessions: result.sessions };
      }
      if (provider === 'gemini' && path.endsWith('.json')) {
        const result = await readGeminiJsonFile(path);
        return { offset: 0, context: { ...context, mtimeMs }, records: result.records, turns: result.turns, sessions: result.sessions };
      }
      const seeded = { ...context };
      if (provider === 'antigravity') {
        const match = agyTranscriptRe.exec(path);
        if (match) {
          seeded.sessionId ??= match[2]!;
          if (!seeded.cwd) seeded.cwd = readAgyWorkspaceCwd(match[1]!, seeded.sessionId);
        }
      } else if (provider === 'gemini' && !seeded.cwd) {
        seeded.cwd = await readGeminiProjectRoot(path);
      }
      const file = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(chunkBytes);
        const { bytesRead } = await file.read(buffer, 0, chunkBytes, offset);
        const result = parseChunk(provider, buffer.subarray(0, bytesRead), seeded, bytesRead === chunkBytes);
        return { offset: offset + result.consumed, context: result.context, records: result.records, turns: result.turns, sessions: result.sessions };
      } finally { await file.close(); }
    },
  },
});
