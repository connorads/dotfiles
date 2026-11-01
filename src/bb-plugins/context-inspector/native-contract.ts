import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const threadKey = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const claudeLaunchOverrides = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'] as const;
const count = z.number().finite().nonnegative();
export const nativeCategory = z.object({
  id: z.string(), label: z.string(), kind: z.enum(['used', 'reserved', 'free', 'deferred']), tokens: count,
  entries: z.array(z.object({ id: z.string(), label: z.string(), tokens: count })).max(500),
});
export const nativeResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
  z.object({ kind: z.literal('available'), provider: z.enum(['codex', 'claude-code']),
    scope: z.enum(['last-request', 'saved-session']), capturedAt: z.string(), providerSessionId: z.string(),
    requestId: z.string().nullable(), method: z.string(), totalTokens: count,
    categories: z.array(nativeCategory).max(100), notes: z.array(z.string()).max(20),
  }),
]);
export type NativeResult = z.infer<typeof nativeResult>;
export type NativeReport = Extract<NativeResult, { kind: 'available' }>;
export const nativeHostContract = defineRpcContract({
  traceRoot: { input: z.object({ threadId: threadKey }).strict(), output: z.object({ path: z.string() }) },
  codex: { input: z.object({ threadId: threadKey, sessionId: z.string().min(1) }).strict(), output: nativeResult },
  purge: { input: z.object({ threadId: threadKey }).strict(), output: z.object({ purged: z.boolean() }) },
  claude: { input: z.object({ sessionId: z.string().uuid(), cwd: z.string().min(1), configDir: z.string().optional() }).strict(), output: nativeResult },
});
