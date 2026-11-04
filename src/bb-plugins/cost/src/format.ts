/** Dollars to the cent, with sub-cent amounts shown as such rather than as $0.00. */
export function usd(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toFixed(2)}`;
}

export function tokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}k`;
  return String(value);
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Short model names for tight rows: `claude-opus-5-5-20261001` reads as `opus-5-5`. */
export const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
