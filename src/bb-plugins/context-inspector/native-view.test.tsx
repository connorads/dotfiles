// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NativeCosts } from './native-view';
import type { NativeReport } from './native-contract';

afterEach(cleanup);
const report: NativeReport = {
  kind: 'available', provider: 'claude-code', scope: 'saved-session', capturedAt: '2026-01-01T12:00:00Z',
  providerSessionId: 'synthetic-session', requestId: null, method: 'Native summary estimate', totalTokens: 100,
  categories: [
    { id: 'messages', label: 'Messages', kind: 'used', tokens: 100, entries: [
      { id: 'small', label: 'User messages', tokens: 20 }, { id: 'large', label: 'Tool results', tokens: 90 },
    ] },
    { id: 'buffer', label: 'Compaction reserve', kind: 'reserved', tokens: 40, entries: [] },
    { id: 'deferred', label: 'Deferred tools', kind: 'deferred', tokens: 80, entries: [] },
    { id: 'free', label: 'Available capacity', kind: 'free', tokens: 60, entries: [] },
  ], notes: [],
};
test('keeps source rows when native estimates exceed the category total', () => {
  const { container } = render(<NativeCosts report={report} />);
  fireEvent.click(screen.getByText('Messages'));
  expect(screen.getByText('Tool results')).toBeTruthy();
  expect(screen.getByText('User messages')).toBeTruthy();
  expect(screen.getByText(/Source estimates exceed this total by 10 tokens/)).toBeTruthy();
  const rows = Array.from(container.querySelectorAll('.ci-native-entry')).map(row => row.textContent);
  expect(rows[0]).toContain('Tool results');
  expect(rows[1]).toContain('User messages');
});
test('separates capacity and deferred material from used categories', () => {
  render(<NativeCosts report={report} />);
  expect(screen.getByRole('region', { name: 'Capacity and deferred material' })).toBeTruthy();
  expect(screen.getByText('Deferred tools')).toBeTruthy();
  expect(screen.getByText('Saved-session diagnostic')).toBeTruthy();
  expect(screen.getByText('Native summary estimate')).toBeTruthy();
});
test('shows missing source detail without inventing rows', () => {
  const partial = structuredClone(report);
  partial.categories[0].entries = [{ id: 'one', label: 'Known source', tokens: 60 }];
  render(<NativeCosts report={partial} />);
  expect(screen.getByText(/40 tokens without source detail/)).toBeTruthy();
  expect(screen.queryByText('Unknown source')).toBeNull();
});
test('codex recording is explicit and reports process activation and raw files', () => {
  const changed = vi.fn(); const collect = vi.fn(); const purge = vi.fn();
  render(<NativeCosts report={null} provider="codex" tracingEnabled={false} onTracingChange={changed} onCollect={collect} onPurge={purge} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Record future Codex requests' }));
  expect(changed).toHaveBeenCalledWith(true);
  expect(screen.getByText(/Raw diagnostic files/)).toBeTruthy();
  expect(screen.getByText(/when Codex next starts/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Read latest request' }));
  expect(collect).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Delete recorded traces' }));
  expect(purge).toHaveBeenCalledOnce();
});
test('uses distinct read action for Claude and disables pending controls', () => {
  render(<NativeCosts report={null} provider="claude-code" loading onCollect={vi.fn()} />);
  expect((screen.getByRole('button', { name: 'Read native summary' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('checkbox')).toBeNull();
});
test('unavailable result is explicit and contains no invented estimate', () => {
  render(<NativeCosts report={{ kind: 'unavailable', reason: 'No captured request for this session.' }} provider="codex" />);
  expect(screen.getByRole('status').textContent).toBe('No captured request for this session.');
  expect(screen.queryByText('Estimated material')).toBeNull();
});
