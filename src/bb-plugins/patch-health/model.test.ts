import { describe, expect, it } from 'vitest';
import { fromInspection } from './model';
const observedAt = '2026-01-01T12:00:00.000Z';
const report = (classification: string, missingPatches: string[]) => ({
  schema: 1, classification, requiredSet: 'session-options-plus-activity', missingPatches,
  observation: { app: '/Applications/bb.app', identity: { version: '0.48.1' } },
  pendingTransaction: null, activationStatus: 'unknown', runtimeVerificationStatus: 'unknown',
});
describe('desktop patch inspection', () => {
  it('reports recognised stock files as missing, never as failed live checks', () => {
    const result = fromInspection(report('stock', ['activity', 'session-options']), 1, observedAt);
    expect(result.kind).toBe('available');
    if (result.kind !== 'available') return;
    expect(result.patches.map(patch => patch.files)).toEqual(['absent', 'absent']);
    expect(result.patches.every(patch => patch.behaviour === 'not-checked')).toBe(true);
  });
  it('does not turn a complete installed profile into a live pass', () => {
    const result = fromInspection(report('requested-profile', []), 0, observedAt);
    expect(result.kind).toBe('available');
    if (result.kind !== 'available') return;
    expect(result.patches.every(patch => patch.files === 'present' && patch.behaviour === 'not-checked')).toBe(true);
    expect(result.loadedIdentity).toBe('unavailable');
  });
  it.each(['legacy-mixed', 'journal-backed-mixed', 'unknown'])('does not trust per-file mixtures or unknown tuples: %s', classification => {
    const result = fromInspection(report(classification, []), 2, observedAt);
    expect(result.kind).toBe('available');
    if (result.kind !== 'available') return;
    expect(result.patches.every(patch => patch.files === 'unverified')).toBe(true);
  });
  it('keeps constituent capabilities separate', () => {
    const result = fromInspection(report('other-approved-profile', ['activity']), 1, observedAt);
    expect(result.kind).toBe('available');
    if (result.kind !== 'available') return;
    expect(result.patches.map(patch => patch.files)).toEqual(['absent', 'present']);
  });
  it('refuses a report for another target or a different requested set', () => {
    const wrongTarget = report('stock', []); wrongTarget.observation.app = '/tmp/Other.app';
    expect(fromInspection(wrongTarget, 0, observedAt).kind).toBe('unavailable');
    expect(fromInspection({ ...report('stock', []), requiredSet: null }, 0, observedAt).kind).toBe('unavailable');
  });
  it('refuses an incomplete report and preserves a bounded manager diagnostic', () => {
    expect(fromInspection({}, 0, observedAt).kind).toBe('unavailable');
    const result = fromInspection({ error: 'Desktop is not installed.' }, 2, observedAt);
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toBe('Desktop is not installed.');
  });
  it('refuses contradictory exit status and missing capability data', () => {
    expect(fromInspection(report('stock', ['activity']), 0, observedAt).kind).toBe('unavailable');
    expect(fromInspection(report('stock', []), 2, observedAt).kind).toBe('unavailable');
  });
});
