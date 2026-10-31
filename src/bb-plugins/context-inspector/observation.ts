import type { BbPluginApi } from '@get-bb/plugin-sdk';

/** Same-response SDK data only. No independent snapshot joins. */
export type RecordedContext = Awaited<ReturnType<BbPluginApi['sdk']['threads']['context']>>;
export interface Target {
  threadId: string;
  hostId: string;
  providerSessionId?: string;
}
export interface Observation {
  target: Target;
  receivedAt: string;
  context: RecordedContext;
}
export type ObservationState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'recorded'; observation: Observation };

export function sameTarget(a: Target, b: Target): boolean {
  return a.threadId === b.threadId && a.hostId === b.hostId &&
    a.providerSessionId === b.providerSessionId;
}

export function describeObservation(target: Target, state: ObservationState) {
  if (state.kind !== 'recorded') return { kind: state.kind, message: state.kind === 'loading' ? 'Loading recorded context.' : state.reason };
  const observation = state.observation;
  if (!sameTarget(target, observation.target)) return { kind: 'loading', message: 'Waiting for the selected target.' };
  const usage = observation.context.usage;
  if (!usage) return { kind: 'unavailable', message: 'Recorded context is unavailable.' };
  const snapshot = usage.snapshot;
  const conflict = snapshot && target.providerSessionId !== undefined && snapshot.providerSessionId !== target.providerSessionId;
  const mismatchedCounts = snapshot && (snapshot.usedTokens !== usage.usedTokens || snapshot.contextWindowTokens !== usage.modelContextWindow);
  return {
    kind: 'recorded', usage,
    snapshot: conflict || mismatchedCounts ? undefined : snapshot,
    message: conflict ? 'Category detail withheld: provider session conflict.' : mismatchedCounts ? 'Category detail withheld: counts conflict.' : !snapshot ? 'Attribution unavailable: no category detail recorded.' : !target.providerSessionId ? 'Same-response categories. Provider identity is unverified.' : 'Same-response categories. Provider session matches the selected target.',
  };
}
