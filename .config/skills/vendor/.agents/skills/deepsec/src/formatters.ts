import type { Severity } from "@deepsec/core";

export function severityColor(severity: Severity): string {
  switch (severity) {
    case "CRITICAL":
      return "\x1b[31m"; // red
    case "HIGH":
      return "\x1b[33m"; // yellow
    case "MEDIUM":
      return "\x1b[36m"; // cyan
    case "HIGH_BUG":
      return "\x1b[35m"; // magenta
    case "BUG":
      return "\x1b[35m"; // magenta
    case "LOW":
      return "\x1b[90m"; // bright black
  }
}

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function formatCount(n: number, label: string): string {
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}
