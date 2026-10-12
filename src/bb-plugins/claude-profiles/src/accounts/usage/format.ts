import { pace, periodStart, tone, type Pace, type Period, type Tone } from './pace.ts';
import type { UsageWindow } from './contract.ts';

const DAY = 86_400_000;

export function duration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}

/** Today as a time, this week as weekday and time, later as a date and time. */
export function clock(date: Date, now: Date): string {
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  if (date.getTime() - now.getTime() < 6 * DAY) return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

export function money(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: dollars < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function percent(value: number): string {
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

export const SHORT: Record<Period, string> = { 'five-hour': '5h', day: '24h', week: '7d', month: 'Mo' };

export type ReadingState = 'fresh' | 'stale' | 'unknown';

/** Tmux distrusts a reading after 4% of its shortest window, with a 15-minute floor. */
export function readingState(observedAt: number | null, windows: UsageWindow[], now: Date): ReadingState {
  if (observedAt === null) return 'unknown';
  const lengths = windows.flatMap(window => {
    if (window.period === null || window.resetsAt === null) return [];
    const reset = new Date(window.resetsAt);
    return Number.isFinite(reset.getTime()) ? [reset.getTime() - periodStart(window.period, reset).getTime()] : [];
  });
  const threshold = Math.max(15 * 60_000, lengths.length ? Math.min(...lengths) * 0.04 : 0);
  return now.getTime() - observedAt >= threshold ? 'stale' : 'fresh';
}

export function readingAge(observedAt: number | null, now: Date): string {
  if (observedAt === null) return 'Reading time unavailable';
  const age = Math.max(0, now.getTime() - observedAt);
  return age < 60_000 ? 'Read just now' : `Read ${duration(age)} ago`;
}

export function expiryClock(date: Date): string {
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

export interface WindowView {
  pace: Pace;
  tone: Tone;
  /** What the reading means for the user now. */
  status: string;
  reset: string | null;
  /** Credits are an allowance, not a rate limit. */
  credit: boolean;
}

export function viewWindow(window: UsageWindow, now: Date, reading: ReadingState = 'fresh'): WindowView {
  const timed = pace(window, now);
  const value: Pace = reading !== 'fresh' && timed.kind !== 'elapsed' ? { kind: 'untimed' } : timed;
  const resetsAt = window.resetsAt === null ? null : new Date(window.resetsAt);
  const until = resetsAt && Number.isFinite(resetsAt.getTime()) && resetsAt > now ? resetsAt : null;
  const credit = window.cost !== null && window.period === null;
  const reset = until === null ? null
    : credit ? `Expires ${clock(until, now)}`
    : `Resets ${clock(until, now)} · in ${duration(until.getTime() - now.getTime())}`;
  if (credit && window.cost) {
    return { pace: value, tone: tone(window.usedPercent, value), credit, reset,
      status: value.kind === 'elapsed' ? 'Expired · refresh needed' : `${money(window.cost.usedUsdCents)} of ${money(window.cost.limitUsdCents)}` };
  }
  const status = (() => {
    if (value.kind !== 'elapsed' && reading !== 'fresh') return reading === 'stale' ? 'Cached reading' : 'Reading age unknown';
    switch (value.kind) {
      case 'elapsed': return 'Reset since last check';
      case 'limited': return 'Limit reached';
      case 'untimed': return window.resetsAt === null && window.usedPercent === 0 ? 'Not started' : '';
      case 'early': return window.usedPercent === 0 ? 'Unused' : 'Just started';
      case 'paced':
        if (window.usedPercent === 0) return 'Unused';
        if (value.status === 'over' && value.runsOutAt) return `At this pace, out ${clock(value.runsOutAt, now)}`;
        return { under: 'Under pace', on: 'On pace', ahead: 'Ahead of pace', over: 'Ahead of pace' }[value.status];
    }
  })();
  return { pace: value, tone: tone(window.usedPercent, value), credit, reset, status };
}

const RANK: Record<Tone, number> = { normal: 0, warning: 1, critical: 2 };

/** The window most likely to stop work: worst tone first, then highest use. Obsolete readings never bind. */
export function bindingWindow(windows: UsageWindow[], now: Date): { window: UsageWindow; view: WindowView } | null {
  const live = windows.filter(window => !(window.cost !== null && window.period === null))
    .map(window => ({ window, view: viewWindow(window, now) }))
    .filter(entry => entry.view.pace.kind !== 'elapsed');
  live.sort((a, b) => RANK[b.view.tone] - RANK[a.view.tone] || b.window.usedPercent - a.window.usedPercent);
  return live[0] ?? null;
}
