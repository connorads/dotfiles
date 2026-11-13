import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Claude Code's Keychain service for a non-default CLAUDE_CONFIG_DIR. */
export function keychainService(configDir: string): string {
  const suffix = createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

const stored = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    expiresAt: z.number(),
    scopes: z.array(z.string()).default([]),
  }),
});

export type Token = { accessToken: string; expiresAt: number; scopes: string[] };

/** Parses the Keychain item; throws a message that never contains the token. */
export function parseToken(raw: string): Token {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('The Keychain item is not JSON.'); }
  const parsed = stored.safeParse(value);
  if (!parsed.success) throw new Error('The Keychain item has no claude.ai login.');
  return parsed.data.claudeAiOauth;
}

// Claude Code renews only inside its last few minutes; a wider margin runs `claude mcp list` for nothing.
export const REFRESH_MARGIN_MS = 4 * 60_000;

export function needsRefresh(token: Token, now: number): boolean {
  return token.expiresAt - now < REFRESH_MARGIN_MS;
}

export const CONNECTOR_SCOPE = 'user:mcp_servers';
