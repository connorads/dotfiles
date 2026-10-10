import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hostContract } from './contracts.ts';
import { parseTranscript } from './src/transcript.ts';

const paths = new Map<string, string>();
async function locate(configDir: string | null, sessionId: string) {
  const projects = join(configDir ?? join(homedir(), '.claude'), 'projects');
  const key = JSON.stringify([projects, sessionId]);
  const known = paths.get(key);
  if (known) return known;
  for (const project of await readdir(projects, { withFileTypes: true })) {
    const path = join(projects, project.name, `${sessionId}.jsonl`);
    if (project.isDirectory() && await stat(path).then(value => value.isFile(), () => false)) {
      paths.set(key, path);
      return path;
    }
  }
  throw new Error(`No Claude Code transcript for session ${sessionId} under ${projects}.`);
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    transcript: async input => {
      const file = await open(await locate(input.configDir, input.sessionId), 'r');
      try {
        const { size } = await file.stat();
        if (size <= input.offset) return { offset: input.offset, items: [] };
        const chunk = Buffer.alloc(size - input.offset);
        const { bytesRead } = await file.read(chunk, 0, chunk.length, input.offset);
        const { consumed, items } = parseTranscript(chunk.subarray(0, bytesRead));
        return { offset: input.offset + consumed, items };
      } finally { await file.close(); }
    },
  },
});
