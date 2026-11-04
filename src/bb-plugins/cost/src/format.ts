/** Dollars to the cent, with sub-cent amounts shown as such rather than as $0.00. */
export function usd(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toFixed(2)}`;
}

/** Whole dollars for axes and tight labels: $950, $1.5k, $12k. */
export function usdShort(value: number): string {
  if (value >= 10_000) return `$${Math.round(value / 1000)}k`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return value > 0 && value < 1 ? usd(value) : `$${Math.round(value)}`;
}

export function tokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}k`;
  return String(value);
}

export const count = (value: number) => value.toLocaleString('en-US');

export function percent(value: number): string {
  if (value > 0 && value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
export const dayLabel = (day: string) => parseDay(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const dayShort = (day: string) => parseDay(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const dateLabel = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Short model names for tight rows: `claude-opus-5-5-20261001` reads as `opus-5-5`. */
export const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '');

export const providerName: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'Pi' };

/** The last path segment names a project directory. */
export const folder = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

/** Round an axis maximum up to a clean step (1, 2, 2.5 or 5 times a power of ten) and return the ticks. */
export function niceTicks(max: number, steps = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(value => value >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = 0; value < max + step * 0.999; value += step) ticks.push(value);
  return ticks;
}
