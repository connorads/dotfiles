// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextInspectorView, FixtureContextInspector } from './view';
import { fixtures, fixtureTarget, fixtureOwner } from './fixtures';
afterEach(cleanup);

it('switches between recorded evidence and future preview without changing counts', () => {
  render(<FixtureContextInspector />);
  expect(screen.getByText(/Synthetic fixture/)).toBeTruthy();
  expect(screen.getByText(/12,000 \/ 100,000 tokens/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Future owner preview' }));
  expect(screen.getByText(/Historical session configuration is unknown/)).toBeTruthy();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText('No desired-value change.')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getAllByText(/"introduction": false/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded context' }));
  expect(screen.getByText(/12,000 \/ 100,000 tokens/)).toBeTruthy();
  expect(screen.queryByText(/plugin-config.json/)).toBeNull();
});
it('does not infer source inclusion from a category label', () => {
  render(<ContextInspectorView target={fixtureTarget} state={fixtures.Categories} ownerText={fixtureOwner} />);
  expect(screen.getByText(/Provider identity is unverified/)).toBeTruthy();
  expect(screen.getByText(/Category labels do not prove/)).toBeTruthy();
});
it('clears future draft and hides old response immediately on target switch', () => {
  const props = { target: fixtureTarget, state: fixtures['Count only'], ownerText: fixtureOwner };
  const view = render(<ContextInspectorView {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Future owner preview' }));
  fireEvent.click(screen.getByRole('checkbox'));
  view.rerender(<ContextInspectorView {...props} target={{ threadId: 'thread-new', hostId: 'host-demo' }} />);
  expect(screen.getByText(/Waiting for the selected target/)).toBeTruthy();
  expect(screen.queryByText(/12,000/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Future owner preview' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
});

it('blocks owner preview when unavailable and distinguishes current saved state', () => {
  render(<ContextInspectorView target={fixtureTarget} state={fixtures['Count only']} ownerText="" ownerUnavailable="Owner read refused." savedIntroduction={true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Future owner preview' }));
  expect(screen.getByRole('alert').textContent).toBe('Owner read refused.');
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/Live saved value: true.*current saved state/)).toBeTruthy();
  expect(screen.queryByText('Desired-owner JSON')).toBeNull();
});
it('exports only after an explicit action and guards unknown capacity', () => {
  const exported: string[] = [];
  const state = structuredClone(fixtures['Count only']);
  if (state.kind !== 'recorded' || !state.observation.context.usage) throw new Error('Expected usage');
  state.observation.context.usage.modelContextWindow = 0;
  render(<ContextInspectorView target={fixtureTarget} state={state} ownerText={fixtureOwner} onExportPatch={patch => exported.push(patch)} />);
  expect(screen.queryByRole('meter')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Future owner preview' }));
  expect(exported).toEqual([]);
  expect((screen.getByRole('button', { name: 'Export private patch' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Export private patch' }));
  expect(exported[0]).toContain('+++ b/.config/bb/plugin-config.json');
});
