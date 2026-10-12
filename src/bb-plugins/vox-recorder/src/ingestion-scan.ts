import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFacts, type IsAlive, type VoxPaths } from './disk.ts';
import { isRecordingName } from './library.ts';
import { digest, type Candidate } from './ingestion.ts';

/** Directory inode and birth time survive a rename and separate same-second imports. */
export async function completedTranscripts(paths: VoxPaths, alive: IsAlive): Promise<Candidate[]> {
  const facts = await readFacts(paths, alive);
  const busy = new Set(facts.jobs.filter(job => job.alive).map(job => job.dir));
  if (facts.capture?.alive) busy.add(facts.capture.dir);
  let names: string[];
  try { names = (await readdir(paths.store)).filter(isRecordingName).sort(); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error; }
  const candidates: Candidate[] = [];
  for (const name of names) {
    const dir = join(paths.store, name);
    if (busy.has(dir)) continue;
    const path = join(dir, 'transcript.md');
    try {
      const directory = await stat(dir);
      if (!directory.isDirectory()) continue;
      const text = await readFile(path, 'utf8');
      if (!text.trim()) continue;
      candidates.push({ identity: `${paths.store}:${directory.ino}:${directory.birthtimeMs}`, name, path, hash: digest(text) });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return candidates;
}
