import { z } from 'zod';

export const desktopApp = '/Applications/bb.app';
const patchId = z.enum(['activity', 'session-options']);
const classification = z.enum(['stock', 'requested-profile', 'other-approved-profile', 'legacy-mixed', 'journal-backed-mixed', 'unknown']);
const patch = z.object({ id: patchId, files: z.enum(['present', 'absent', 'unverified']), behaviour: z.literal('not-checked') });
export const snapshotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), app: z.literal(desktopApp), version: z.string(), classification,
    patches: z.array(patch), pendingState: z.string().nullable(), observedAt: z.string().datetime(), loadedIdentity: z.literal('unavailable') }),
  z.object({ kind: z.literal('unavailable'), app: z.literal(desktopApp), reason: z.string(), observedAt: z.string().datetime() }),
]);
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Patch = z.infer<typeof patch>;
const inspection = z.object({ schema: z.literal(1), classification, requiredSet: z.literal('session-options-plus-activity'),
  observation: z.object({ app: z.literal(desktopApp), identity: z.object({ version: z.string().min(1).max(80) }) }),
  missingPatches: z.array(patchId), pendingTransaction: z.object({ state: z.string().max(80) }).nullable(),
  activationStatus: z.literal('unknown'), runtimeVerificationStatus: z.literal('unknown'),
});
export function unavailable(reason: string, observedAt: string): Snapshot {
  return { kind: 'unavailable', app: desktopApp, reason: reason.slice(0, 400), observedAt };
}

/** Only complete, recognised tuples establish file presence. Live claims stay separate. */
export function fromInspection(input: unknown, exitCode: number | null, observedAt: string): Snapshot {
  const parsed = inspection.safeParse(input);
  if (!parsed.success) {
    const diagnostic = z.object({ error: z.string().max(2000) }).safeParse(input);
    return unavailable(diagnostic.success ? diagnostic.data.error : 'The patch inspector returned an invalid report.', observedAt);
  }
  const report = parsed.data;
  const recognised = ['stock', 'requested-profile', 'other-approved-profile'].includes(report.classification);
  const expectedExit = recognised ? report.missingPatches.length ? 1 : 0 : 2;
  if (exitCode !== expectedExit || new Set(report.missingPatches).size !== report.missingPatches.length
    || report.classification === 'stock' && report.missingPatches.length !== 2
    || report.classification === 'requested-profile' && report.missingPatches.length !== 0) {
    return unavailable('The patch inspector returned conflicting status evidence.', observedAt);
  }
  return {
    kind: 'available', app: desktopApp, version: report.observation.identity.version, classification: report.classification,
    patches: (['activity', 'session-options'] as const).map(id => ({ id,
      files: !recognised ? 'unverified' : report.missingPatches.includes(id) ? 'absent' : 'present', behaviour: 'not-checked' })),
    pendingState: report.pendingTransaction?.state ?? null, observedAt, loadedIdentity: 'unavailable',
  };
}
