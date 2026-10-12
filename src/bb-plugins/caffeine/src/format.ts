import type { CaffeineView } from './domain.ts';

/** Durations offered from OFF (keys 1-5), and as additions while ON (keys 1-4). */
export const START_OPTIONS = [1800, 3600, 7200, 14400, 28800] as const;
export const EXTEND_OPTIONS = [1800, 3600, 7200, 14400] as const;

/** Compact age, floored: identical to caffeine_human_age so the chip and the tmux pill read the same. */
export function humanAge(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 86400) return `${Math.floor(s / 86400)}d`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

/** Two units where the chip has room for one: `1h 42m`, `5m`, `40s`. */
export function longDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 3600) {
    const minutes = Math.floor((s % 3600) / 60);
    return `${Math.floor(s / 3600)}h${minutes ? ` ${minutes}m` : ''}`;
  }
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

/** Local wall-clock HH:MM, the answer to "until when". */
export function clockAt(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export const untilLabel = (ms: number) => `until ${clockAt(ms)}`;

export function durationLabel(secs: number): string {
  if (secs < 3600) return `${Math.round(secs / 60)} minutes`;
  const hours = secs / 3600;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** Share of the session still to run, for the progress meter. */
export function remainingFraction(now: number, startedAt: number, deadline: number): number {
  const total = deadline - startedAt;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (deadline - now) / total));
}

const secsUntil = (ms: number, now: number) => (ms - now) / 1000;

export type ChipTone = 'on' | 'lid';
export interface ChipFace { tone: ChipTone; glyph: string; token: string; title: string }

/** The header chip's face; null renders nothing, as the tmux pill self-hides when off. */
export function chipFace(view: CaffeineView, now: number): ChipFace | null {
  switch (view.kind) {
    case 'off':
    case 'unsupported':
      return null;
    case 'on':
      if (view.deadline === null) return { tone: 'on', glyph: '☼', token: '∞', title: 'Keeping this Mac awake indefinitely' };
      return {
        tone: 'on', glyph: '☼', token: humanAge(secsUntil(view.deadline, now)),
        title: `Keeping this Mac awake for ${humanAge(secsUntil(view.deadline, now))}, ${untilLabel(view.deadline)}`,
      };
    case 'lid':
      return {
        tone: 'lid', glyph: '✷', token: humanAge(secsUntil(view.deadline, now)),
        title: `You can close the lid. This Mac cannot sleep for ${humanAge(secsUntil(view.deadline, now))}, ${untilLabel(view.deadline)}`,
      };
    case 'agents':
      if (view.graceUntil !== null) {
        const left = humanAge(secsUntil(view.graceUntil, now));
        return { tone: 'on', glyph: '☼', token: `A·${left}`, title: `No agents running. Keep-awake stops in ${left}, at ${clockAt(view.graceUntil)}` };
      }
      if (view.busy !== null) {
        const agents = view.busy === 1 ? '1 agent runs' : `${view.busy} agents run`;
        return { tone: 'on', glyph: '☼', token: `A${view.busy}`, title: `Keeping this Mac awake while ${agents}` };
      }
      return { tone: 'on', glyph: '☼', token: 'A', title: 'Keeping this Mac awake while agents run' };
  }
}
