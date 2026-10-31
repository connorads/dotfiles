import { z } from 'zod';

/** Recognises OpenCode usage resources from the ACP and standalone provider plugins. */
export function openCodeAccountHost(accountId: string): string | null {
  const separator = accountId.indexOf(':');
  const source = accountId.slice(0, separator);
  const provider = source === 'provider-acp' ? 'acp-opencode' : source === 'provider-opencode' ? 'opencode' : null;
  if (!provider) return null;
  try {
    return z.tuple([z.string().min(1), z.literal(provider)])
      .parse(JSON.parse(accountId.slice(separator + 1)))[0];
  } catch { return null; }
}
