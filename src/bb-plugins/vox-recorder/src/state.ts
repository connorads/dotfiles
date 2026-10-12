// The vox state machine, ported from vox-lib.sh as pure functions over file
// facts. Every state comes from a file whose staleness cannot lie (a pid's
// liveness, an mtime comparison), so nothing here needs a reaper.
//
//   RECORDING > TRANSCRIBING > EMPTY > READY > IDLE   (worst first)

export const JOB_MARKER = 'transcribing.pid';

export interface Capture { pids: string[]; startedAt: number | null; dir: string }
export interface Job { pid: string; startedAt: number | null }

/** What the host read from disk at one moment. Liveness is already resolved. */
export interface Facts {
  capture: (Capture & { alive: boolean }) | null;
  jobs: readonly { dir: string; startedAt: number | null; alive: boolean }[];
  transcripts: readonly { dir: string; size: number; mtimeMs: number }[];
  /** mtime of the seen marker; null when it does not exist yet. */
  seenMtimeMs: number | null;
}

export type VoxState = 'recording' | 'transcribing' | 'empty' | 'ready' | 'idle';
export interface VoxStatus {
  state: VoxState;
  recording: { dir: string; startedAt: number | null } | null;
  jobs: { count: number; oldestStartedAt: number | null; newestDir: string | null };
  unread: number;
  empty: number;
}

const epoch = (field: string | undefined) => field && /^\d+$/.test(field) ? Number(field) : null;

/**
 * The statefile is one line, `pid start_epoch dir`. Like `read -r a b c`, the
 * remainder lands in the last field, so a directory holding spaces survives.
 * The first field may be a comma-separated pid list, leader first.
 */
export function parseStatefile(text: string): Capture | null {
  const line = (text.split('\n')[0] ?? '').replace(/^ +| +$/g, '');
  const match = /^(\S+)(?: +(\S+))?(?: +(.*))?$/.exec(line);
  if (!match) return null;
  return { pids: match[1]!.split(',').filter(Boolean), startedAt: epoch(match[2]), dir: match[3] ?? '' };
}

/** `<dir>/transcribing.pid` holds `pid start_epoch`. */
export function parseJobMarker(text: string): Job | null {
  const [pid, start] = (text.split('\n')[0] ?? '').trim().split(/ +/);
  return pid ? { pid, startedAt: epoch(start) } : null;
}

export function deriveStatus(facts: Facts): VoxStatus {
  const live = facts.jobs.filter(job => job.alive).sort((a, b) => b.dir.localeCompare(a.dir));
  const starts = live.map(job => job.startedAt).filter((start): start is number => start !== null);
  // `find -newer` is strictly newer; no marker at all means everything is unread.
  const unseen = facts.transcripts.filter(t => facts.seenMtimeMs === null || t.mtimeMs > facts.seenMtimeMs);
  const status: Omit<VoxStatus, 'state'> = {
    recording: facts.capture?.alive && facts.capture.pids.length ? { dir: facts.capture.dir, startedAt: facts.capture.startedAt } : null,
    jobs: { count: live.length, oldestStartedAt: starts.length ? Math.min(...starts) : null, newestDir: live[0]?.dir ?? null },
    unread: unseen.filter(t => t.size > 0).length,
    empty: unseen.filter(t => t.size === 0).length,
  };
  const state: VoxState = status.recording ? 'recording' : status.jobs.count ? 'transcribing'
    : status.empty ? 'empty' : status.unread ? 'ready' : 'idle';
  return { state, ...status };
}

/** Compact age, Nd / Nh / Nm / Ns, matching vox_human_age. */
export function humanAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d`;
  if (s >= 3_600) return `${Math.floor(s / 3_600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

export interface Pill { glyph: '~' | '≈' | '!' | '✓'; text: string; tone: 'muted' | 'ready' | 'empty'; label: string }

const elapsed = (startedAt: number | null, nowS: number) => startedAt === null ? 0 : Math.max(0, nowS - startedAt);

/** The header pill: null while idle, so it self-hides like the tmux segment. */
export function pill(status: VoxStatus, nowS: number): Pill | null {
  switch (status.state) {
    case 'recording': {
      const age = humanAge(elapsed(status.recording?.startedAt ?? null, nowS));
      return { glyph: '~', text: age, tone: 'muted', label: `Recording for ${age}` };
    }
    case 'transcribing': {
      const many = status.jobs.count > 1;
      const text = many ? String(status.jobs.count) : humanAge(elapsed(status.jobs.oldestStartedAt, nowS));
      return { glyph: '≈', text, tone: 'muted', label: many ? `Transcribing ${text} recordings` : `Transcribing for ${text}` };
    }
    case 'empty':
      return { glyph: '!', text: String(status.empty), tone: 'empty', label: `${status.empty} recording${status.empty === 1 ? '' : 's'} transcribed to nothing` };
    case 'ready':
      return { glyph: '✓', text: String(status.unread), tone: 'ready', label: `${status.unread} new transcript${status.unread === 1 ? '' : 's'}` };
    case 'idle':
      return null;
  }
}
