import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import type { ActionResult, CaffeineView, Details, LibStatus } from './src/domain.ts';

const reason = z.enum(['not-macos', 'no-caffeinate', 'no-lib', 'no-host']);
const ms = z.number();

export const libStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unsupported'), reason }),
  z.object({ kind: z.literal('off') }),
  z.object({
    kind: z.literal('on'), lid: z.boolean(), pid: z.number().int().positive(), deadline: ms.nullable(),
    startedAt: ms, owner: z.string().nullable(),
  }),
]);

export const viewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unsupported'), reason }),
  z.object({ kind: z.literal('off') }),
  z.object({ kind: z.literal('on'), deadline: ms.nullable(), startedAt: ms }),
  z.object({ kind: z.literal('lid'), deadline: ms, startedAt: ms }),
  z.object({ kind: z.literal('agents'), busy: z.number().int().nonnegative().nullable(), graceUntil: ms.nullable(), leaseDeadline: ms.nullable() }),
]);

const hostDetails = z.object({ sleepDisabled: z.boolean(), onBattery: z.boolean().nullable() });
export const detailsSchema = hostDetails.extend({ busyNow: z.number().int().nonnegative() });

export const actionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string(), stoppedPrevious: z.boolean() }),
]);

// The pure core owns the types; these fail to compile if a schema drifts from them.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const matches: [
  Same<z.infer<typeof libStatusSchema>, LibStatus>, Same<z.infer<typeof viewSchema>, CaffeineView>,
  Same<z.infer<typeof detailsSchema>, Details>, Same<z.infer<typeof actionResultSchema>, ActionResult>,
] = [true, true, true, true];
void matches;

const empty = z.object({});
/** Whole seconds; 0 is indefinite, and only `start` accepts it. */
const secs = z.number().int().positive();

/** Runs on this Mac. Every method goes through one queue in the host worker. */
export const hostContract = defineRpcContract({
  /** Start the 15 s rescan (idempotent); changes arrive as `status` signals. */
  subscribe: { input: empty, output: libStatusSchema },
  details: { input: empty, output: hostDetails },
  start: { input: z.object({ secs: z.number().int().nonnegative() }), output: actionResultSchema },
  startLid: { input: z.object({ secs }), output: actionResultSchema },
  extend: { input: z.object({ add: secs }), output: actionResultSchema },
  stop: { input: empty, output: actionResultSchema },
  startOwned: { input: z.object({ secs }), output: actionResultSchema },
  renewOwned: { input: z.object({ secs }), output: z.object({ result: z.enum(['renewed', 'not-owned']) }) },
  stopOwned: { input: empty, output: z.object({ result: z.enum(['stopped', 'not-owned']) }) },
  clear: { input: empty, output: actionResultSchema },
});
export const hostSignals = {
  status: { payload: libStatusSchema },
};

export const rpcContract = defineRpcContract({
  /** The composed view; also starts the host rescan. */
  state: { input: empty, output: viewSchema },
  details: { input: empty, output: detailsSchema },
  start: { input: z.object({ secs: z.number().int().nonnegative() }), output: actionResultSchema },
  startLid: { input: z.object({ secs }), output: actionResultSchema },
  extend: { input: z.object({ add: secs }), output: actionResultSchema },
  /** Ends agents mode too, when it holds the session. */
  stop: { input: empty, output: actionResultSchema },
  /** Only from OFF: it never replaces a session someone started. */
  startAgents: { input: empty, output: actionResultSchema },
  clearSleepDisabled: { input: empty, output: actionResultSchema },
});
