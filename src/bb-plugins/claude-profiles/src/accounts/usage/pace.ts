export type Period = 'five-hour' | 'day' | 'week' | 'month';
export type Tone = 'normal' | 'warning' | 'critical';
export interface Meter { usedPercent: number; resetsAt: string | null; period: Period | null }
export type Pace =
  | { kind: 'untimed' }
  | { kind: 'elapsed' }
  | { kind: 'limited'; resetsAt: Date }
  | { kind: 'early'; expectedPercent: number }
  | { kind: 'paced'; status: 'under' | 'on' | 'ahead' | 'over'; expectedPercent: number; runsOutAt: Date | null };

const MINUTE = 60_000;
const FIXED: Record<Exclude<Period, 'month'>, number> = { 'five-hour': 300 * MINUTE, day: 1440 * MINUTE, week: 10_080 * MINUTE };
const ON_PACE_POINTS = 5;
const OVER_RATIO = 1.2;
const CRITICAL_RATIO = 1.4;

export function periodStart(period: Period, resetsAt: Date): Date {
  if (period !== 'month') return new Date(resetsAt.getTime() - FIXED[period]);
  const start = new Date(resetsAt);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return start;
}

/** Compares use with even spending across the window; projections assume the rate so far continues. */
export function pace(meter: Meter, now: Date): Pace {
  const resetsAt = meter.resetsAt === null ? null : new Date(meter.resetsAt);
  if (resetsAt === null || !Number.isFinite(resetsAt.getTime())) return { kind: 'untimed' };
  if (resetsAt <= now) return { kind: 'elapsed' };
  if (meter.usedPercent >= 100) return { kind: 'limited', resetsAt };
  if (meter.period === null) return { kind: 'untimed' };
  const start = periodStart(meter.period, resetsAt).getTime();
  const length = resetsAt.getTime() - start;
  const elapsed = Math.max(0, now.getTime() - start);
  const expectedPercent = Math.round(Math.min(100, elapsed * 100 / length) * 10) / 10;
  // Early rates are dominated by a single burst, so projecting from them misleads.
  if (elapsed < Math.max(10 * MINUTE, length * 0.05)) return { kind: 'early', expectedPercent };
  const used = meter.usedPercent;
  const ratio = used / Math.max(expectedPercent, 0.1);
  const status = used - expectedPercent < -ON_PACE_POINTS ? 'under'
    : used - expectedPercent <= ON_PACE_POINTS ? 'on'
    : ratio < OVER_RATIO ? 'ahead' : 'over';
  const runsOutAt = status === 'over' ? new Date(now.getTime() + (100 - used) * elapsed / used) : null;
  return { kind: 'paced', status, expectedPercent, runsOutAt };
}

export function tone(usedPercent: number, value: Pace): Tone {
  if (value.kind === 'elapsed') return 'normal';
  const ratio = value.kind === 'paced' ? usedPercent / Math.max(value.expectedPercent, 0.1) : 0;
  if (value.kind === 'limited' || usedPercent >= 90 || (value.kind === 'paced' && value.status === 'over' && ratio >= CRITICAL_RATIO)) return 'critical';
  if (usedPercent >= 70 || (value.kind === 'paced' && value.status === 'over')) return 'warning';
  return 'normal';
}
