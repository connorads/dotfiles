// The recording store convention: one directory per recording under the
// store, named `YYYY-MM-DD-HHMMSS[-slug]`. The name IS the title, only the
// timestamp prefix is parsed, and solo / 2-way is derived from sys.json.

const namePattern = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(.+))?$/;

export interface RecordingName { stamp: string; startedAt: number; slug: string | null }

/** Parse a recording directory name; null for anything vox did not create. */
export function parseName(name: string): RecordingName | null {
  const match = namePattern.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, slug] = match;
  // Local time, as `date +%Y-%m-%d-%H%M%S` wrote it.
  const startedAt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  if (Number.isNaN(startedAt)) return null;
  return { stamp: name.slice(0, 17), startedAt, slug: slug ?? null };
}

export const titleOf = (name: string) => parseName(name)?.slug?.replace(/-/g, ' ') ?? 'untitled';

/**
 * A safe recording name: vox's own shape, one path segment. Every handler
 * that takes a name from the app goes through this before touching disk.
 */
export const isRecordingName = (name: string) => !name.includes('/') && name !== '..' && parseName(name) !== null;

/**
 * True when the track transcript holds at least one segment. A positive test
 * for a segment object, not for the word "text": real output carries an empty
 * top-level "text" key even when nothing was transcribed.
 */
export function hasSegments(json: string | null): boolean {
  return json !== null && json.replace(/\s/g, '').includes('"segments":[{');
}

export type Kind = 'recording' | 'transcribing' | 'pending' | 'empty' | 'solo' | '2-way';

/**
 * The library's kind column. A recording that transcribed to nothing is
 * `empty`, never `solo`, or it would read as a real monologue.
 */
export function classify(input: { live: boolean; transcribing: boolean; transcriptSize: number | null; sysJson: string | null }): Kind {
  if (input.live) return 'recording';
  if (input.transcribing) return 'transcribing';
  if (input.transcriptSize === null) return 'pending';
  if (input.transcriptSize === 0) return 'empty';
  return hasSegments(input.sysJson) ? '2-way' : 'solo';
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'K', 'M', 'G'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

export interface Recording {
  name: string;
  title: string;
  startedAt: number;
  kind: Kind;
  bytes: number;
}

/** Newest first: names start with the timestamp, so reverse name order is reverse time. */
export const newestFirst = (a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name);

/** `2026-09-17 10:08`, straight from the name, so no timezone can shift it. */
export function when(name: string): string {
  const match = namePattern.exec(name);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : name;
}

/** Recordings with a transcript worth reading. */
export const readable = (recording: Recording) => recording.kind === 'solo' || recording.kind === '2-way';

/** Search over readable recordings, newest first, for mention menus and the agent tool. */
export function search(recordings: readonly Recording[], query: string, limit: number): Recording[] {
  return recordings.filter(recording => readable(recording) && matches(recording, query)).sort(newestFirst).slice(0, limit);
}

export function matches(recording: Recording, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${recording.title} ${recording.name}`.toLowerCase();
  return words.every(word => haystack.includes(word));
}

/** Four honest preview cases: a finished empty transcript is not "not yet". */
export type Preview =
  | { kind: 'transcript'; text: string; truncated: boolean }
  | { kind: 'empty'; log: string }
  | { kind: 'transcribing'; log: string }
  | { kind: 'none'; files: string[] };

export function lastLines(text: string, count: number): string {
  return text.replace(/\n+$/, '').split('\n').slice(-count).join('\n');
}
