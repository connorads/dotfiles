import { describe, it, expect } from 'vitest';
import { describeObservation } from './observation';
import { fixtures, fixtureTarget } from './fixtures';

describe('recorded observation', () => {
  it('keeps counts without manufacturing detail or identity', () => {
    const result = describeObservation(fixtureTarget, fixtures['Count only']);
    expect(result.usage?.usedTokens).toBe(12000);
    expect(result.snapshot).toBeUndefined();
    expect(result.message).toContain('Attribution unavailable');
  });
  it('labels same-response categories without verified provider identity', () => {
    const result = describeObservation(fixtureTarget, fixtures.Categories);
    expect(result.snapshot?.categories[0].tokens).toBe(1000);
    expect(result.message).toContain('unverified');
    expect(result.snapshot?.categories[0].entries).toEqual([]);
  });
  it('withholds known session conflicts even with identical totals', () => {
    const state = structuredClone(fixtures.Categories);
    if (state.kind !== 'recorded') throw new Error('Expected recorded fixture');
    state.observation.target.providerSessionId = 'session-selected';
    const result = describeObservation(state.observation.target, state);
    expect(result.usage?.usedTokens).toBe(12000);
    expect(result.snapshot).toBeUndefined();
    expect(result.message).toContain('session conflict');
  });
  it('withholds mismatched category totals', () => {
    const state = structuredClone(fixtures.Categories);
    if (state.kind !== 'recorded') throw new Error('Expected recorded fixture');
    if (state.observation.context.usage) state.observation.context.usage.usedTokens = 15000;
    const result = describeObservation(fixtureTarget, state);
    expect(result.snapshot).toBeUndefined();
    expect(result.message).toContain('counts conflict');
  });
  it('does not show a late response from another target', () => {
    const result = describeObservation(fixtureTarget, fixtures['Late other target']);
    expect(result.kind).toBe('loading');
    expect(result.usage).toBeUndefined();
  });
  it('shows unavailable usage explicitly', () => {
    expect(describeObservation(fixtureTarget, fixtures.Unavailable).kind).toBe('unavailable');
  });
});
