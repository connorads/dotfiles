import type { MissCause } from './cache.ts';

export function tokens(value: number) {
  if (value < 1000) return String(value);
  return value < 10000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value / 1000)}k`;
}
export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
export function clock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60];
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
}
/** Whole minutes while there is time; seconds only in the last two minutes. */
export const countdown = (ms: number) => ms >= 120_000 ? `${Math.floor(ms / 60_000)}m` : clock(ms);
export const lifetime = (ms: number) => ms >= 3_600_000 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`;
/** Idle gaps as 45s, 7m or 2h 5m. */
export function gap(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export const timeOfDay = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/**
 * Anthropic bills cache writes at 1.25x base input for the 5-minute lifetime and 2x for the 1-hour one.
 * Read prices vary by model (0.1x or less), so only the write rate is quoted.
 */
export const writeMultiplier = (ttlMs: number) => ttlMs >= 3_600_000 ? 2 : 1.25;

/** Why a request re-sent its prefix, as a short phrase. */
export function missReason({ cause, idleMs }: { cause: MissCause; idleMs: number }) {
  switch (cause) {
    case 'idle': return `after ${gap(idleMs)} idle`;
    case 'expired': return `expired after ${gap(idleMs)} idle`;
    case 'model': return 'model switched';
    case 'account': return 'account switched';
    case 'tools': return 'tools, skills or MCP changed';
    case 'prefix': return 'prompt prefix changed';
  }
}
