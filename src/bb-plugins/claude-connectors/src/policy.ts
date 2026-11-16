import type { Tool } from './mcp.ts';

export type Access = 'allow' | 'off';
/** Keyed by `<connector>/<tool>`, connector in lower case. */
export type Overrides = Record<string, Access>;

export function policyKey(connector: string, tool: string): string {
  return `${connector.toLowerCase()}/${tool}`;
}

/** Read-only tools default to allowed; anything that may write is off until allowed, and always off under `readOnly`. */
export function accessFor(connector: string, tool: Tool, overrides: Overrides, readOnly: boolean): Access {
  if (readOnly && tool.annotations?.readOnlyHint !== true) return 'off';
  const explicit = overrides[policyKey(connector, tool.name)];
  if (explicit) return explicit;
  return tool.annotations?.readOnlyHint === true ? 'allow' : 'off';
}
