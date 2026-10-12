// The `vox` CLI contract: bare paths on stdout, diagnostics on stderr, and
// exit 0 only when there is something to read. These pure functions turn one
// run into what the UI says, and decide what the title prompt's answer does.

export interface Run { code: number | null; stdout: string; stderr: string }
export type Outcome = { ok: true; path: string } | { ok: false; path: string | null; reason: string };

const lines = (text: string) => text.split('\n').map(line => line.trimEnd()).filter(Boolean);

/**
 * The last stdout line is the path (stop and grab print it even on failure);
 * the reason is the last stderr line that is not a progress line ending in an
 * ellipsis, which is how vox-grab.sh picks it.
 */
export function interpret(run: Run, fallback: string): Outcome {
  const path = lines(run.stdout).at(-1) ?? null;
  if (run.code === 0 && path) return { ok: true, path };
  return { ok: false, path, reason: reasonOf(run, fallback) };
}

export const reasonOf = (run: Run, fallback: string) => lines(run.stderr).filter(line => !line.endsWith('…')).at(-1) ?? fallback;

export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? path;

export type Answer = { kind: 'enter'; title: string } | { kind: 'escape' };
export type AfterStart =
  | { kind: 'failed'; reason: string }
  | { kind: 'rename'; name: string; title: string }
  | { kind: 'keep'; name: string }
  | { kind: 'discard'; name: string };

/**
 * The prompt opens at once while the capture starts behind it, and how it is
 * dismissed decides the recording's fate: Enter keeps it (renamed if titled),
 * Esc discards it. The answer only acts once the start has returned, so a
 * start that failed is reported and neither renames nor discards.
 */
export function afterStart(start: Outcome, answer: Answer): AfterStart {
  if (!start.ok) return { kind: 'failed', reason: start.reason };
  const name = baseName(start.path);
  if (answer.kind === 'escape') return { kind: 'discard', name };
  const title = answer.title.trim();
  return title ? { kind: 'rename', name, title } : { kind: 'keep', name };
}
