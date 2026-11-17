import type { Tool } from './mcp.ts';

export type Access = 'allow' | 'off';
/** Keyed by `<connector>/<tool>`, connector in lower case. */
export type Overrides = Record<string, Access>;

export function policyKey(connector: string, tool: string): string {
  return `${connector.toLowerCase()}/${tool}`;
}

/** Why a tool is off: it may write and this thread is read-only, or the profile's policy has it off. */
export type Decision = { access: 'allow' } | { access: 'off'; reason: 'read-only-thread' | 'policy' };

/**
 * The one access rule; the tool list shows it and the call enforces it.
 * Read-only tools default to allowed; anything that may write is off until allowed, and always off under `readOnly`.
 */
export function decide(connector: string, tool: Tool, overrides: Overrides, readOnly: boolean): Decision {
  const writes = tool.annotations?.readOnlyHint !== true;
  if (readOnly && writes) return { access: 'off', reason: 'read-only-thread' };
  const access = overrides[policyKey(connector, tool.name)] ?? (writes ? 'off' : 'allow');
  return access === 'allow' ? { access } : { access, reason: 'policy' };
}

export function refusal(connector: string, tool: string, reason: Extract<Decision, { access: 'off' }>['reason']): string {
  return reason === 'read-only-thread'
    ? `${connector}/${tool} can write. This thread has read-only access from the thread that started it, so that thread must make the call.`
    : `${connector}/${tool} is turned off in Claude Connectors. Ask the person to allow it: bb claude-connectors allow "${connector}" ${tool}`;
}
