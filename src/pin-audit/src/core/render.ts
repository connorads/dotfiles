import type { Verdict } from "./types.ts";

/**
 * `pin-audit: OK   ...` / `FLAG ` / `INFO ` / `SKIP ` - a 4-column verdict tag
 * so the report scans vertically. Byte-for-byte the zsh original's format.
 */
export const render = (verdict: Verdict): string =>
  `pin-audit: ${verdict.kind.toUpperCase().padEnd(4)} ${verdict.detail}`;
