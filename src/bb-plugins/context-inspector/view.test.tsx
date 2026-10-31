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
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  expect(screen.getByText(/Historical session configuration is unknown/)).toBeTruthy();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText('No desired-value change.')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getAllByText(/"introduction": false/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  fireEvent.click(screen.getByRole('checkbox'));
  view.rerender(<ContextInspectorView {...props} target={{ threadId: 'thread-new', hostId: 'host-demo' }} />);
  expect(screen.getByText(/Waiting for the selected target/)).toBeTruthy();
  expect(screen.queryByText(/12,000/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
});

it('blocks owner preview when unavailable and distinguishes current saved state', () => {
  render(<ContextInspectorView target={fixtureTarget} state={fixtures['Count only']} ownerText="" ownerUnavailable="Owner read refused." savedIntroduction={true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  expect(screen.getByRole('alert').textContent).toBe('Owner read refused.');
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText('Saved').textContent).toContain('On');
  expect(screen.queryByText('Desired-owner JSON')).toBeNull();
});
it('exports only after an explicit action and guards unknown capacity', () => {
  const exported: string[] = [];
  const state = structuredClone(fixtures['Count only']);
  if (state.kind !== 'recorded' || !state.observation.context.usage) throw new Error('Expected usage');
  state.observation.context.usage.modelContextWindow = 0;
  render(<ContextInspectorView target={fixtureTarget} state={state} ownerText={fixtureOwner} onExportPatch={patch => exported.push(patch)} />);
  expect(screen.queryByRole('meter')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  expect(exported).toEqual([]);
  expect((screen.getByRole('button', { name: 'Export private patch' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Export private patch' }));
  expect(exported[0]).toContain('+++ b/.config/bb/plugin-config.json');
});

it('disables edits and export when owner validation fails', () => {
  render(<ContextInspectorView target={fixtureTarget} state={fixtures['Count only']} ownerText="bad JSON" onExportPatch={() => { throw new Error('Must not export'); }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  expect(screen.getByRole('alert').textContent).toContain('valid JSON');
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Export private patch' })).toBeNull();
});

it('groups sources by owner and filters capabilities without implying inclusion', () => {
  render(<FixtureContextInspector />);
  fireEvent.click(screen.getByRole('button', { name: /Sources/ }));
  expect(screen.getByText('workspace-tools')).toBeTruthy();
  expect(screen.getByText('Disabled')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter sources' }), { target: { value: 'interface' } });
  expect(screen.queryByText('workspace-tools')).toBeNull();
  expect(screen.getByText('Interface design')).toBeTruthy();
  expect(screen.getByText('design-library').closest('details')?.open).toBe(true);
  expect(screen.getByText(/Registrations do not prove inclusion/)).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing source' } });
  expect(screen.getByText('No matching sources')).toBeTruthy();
});

it('shows category kinds and measures each category against window capacity', () => {
  const state = structuredClone(fixtures.Categories);
  if (state.kind !== 'recorded' || !state.observation.context.usage?.snapshot) throw new Error('Expected snapshot');
  state.observation.context.usage.snapshot.categories.push({ id: 'room', label: 'Available capacity', kind: 'free', tokens: 88000, entries: [] });
  const { container } = render(<ContextInspectorView target={fixtureTarget} state={state} ownerText={fixtureOwner} />);
  expect(screen.getByText('free')).toBeTruthy();
  expect((container.querySelector('[data-kind="free"] i') as HTMLElement).style.width).toBe('88%');
});
