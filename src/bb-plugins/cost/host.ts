import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hostContract } from './contracts.ts';
import { parseChunk, type Provider } from './src/records.ts';

const chunkBytes = 8 * 1024 * 1024;
const home = (path: string) => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

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

async function roots(claudeConfigDirs: readonly string[]): Promise<[Provider, string][]> {
  const codex = home(process.env.CODEX_HOME ?? '~/.codex');
  const claude = new Set([home(process.env.CLAUDE_CONFIG_DIR ?? '~/.claude')]);
  for (const pattern of claudeConfigDirs) for (const dir of await expand(pattern)) claude.add(dir);
  return [
    ...[...claude].map(dir => ['claude-code', join(dir, 'projects')] as [Provider, string]),
    ['codex', join(codex, 'sessions')], ['codex', join(codex, 'archived_sessions')],
    ['pi', home(process.env.PI_CODING_AGENT_DIR ? join(process.env.PI_CODING_AGENT_DIR, 'sessions') : '~/.pi/agent/sessions')],
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

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    list: async ({ claudeConfigDirs, since }) => {
      const files: { provider: Provider; path: string; size: number; mtimeMs: number }[] = [];
      const seen = new Set<string>();
      for (const [provider, root] of await roots(claudeConfigDirs))
        await walk(root, since, (path, size, mtimeMs) => { if (!seen.has(path)) { seen.add(path); files.push({ provider, path, size, mtimeMs }); } });
      return { files };
    },
    read: async ({ provider, path, offset, context }) => {
      const file = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(chunkBytes);
        const { bytesRead } = await file.read(buffer, 0, chunkBytes, offset);
        const result = parseChunk(provider, buffer.subarray(0, bytesRead), context, bytesRead === chunkBytes);
        return { offset: offset + result.consumed, context: result.context, records: result.records, sessions: result.sessions };
      } finally { await file.close(); }
    },
  },
});
