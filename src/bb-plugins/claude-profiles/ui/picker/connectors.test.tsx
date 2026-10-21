// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { connectorsContract } from '../../src/accounts/connectors-contract.ts';
import { AccountConnectors } from './connectors.tsx';

function render(disabled = false, fail = false, threadId: string | null = 't1') {
  return renderSlot<{ threadId: string | null; disabled: boolean }, typeof connectorsContract>(
    { component: AccountConnectors }, { threadId, disabled }, {
      rpc: {
        'connectors.get': () => ({ enabled: false, launch: 'off' }),
        'connectors.set': input => {
          if (fail) throw new Error('Could not stop session');
          return { enabled: input.enabled, launch: 'pending' };
        },
      },
    });
}
test('turning account connectors on shows the pending state without submitting a message', async () => {
  const slot = render();
  try {
    const toggle = await slot.findByRole('switch', { name: 'Claude account connectors' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(slot.getByText('Off at launch')).toBeTruthy();
    fireEvent.click(toggle);
    await slot.findByText('Applies when the next turn starts');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'connectors.set').map(call => call.input))
      .toEqual([{ threadId: 't1', enabled: true }]);
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});
test('a running turn cannot change connector access', async () => {
  const slot = render(true);
  try {
    await slot.findByText('Off at launch');
    const toggle = slot.getByRole('switch');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    fireEvent.click(toggle);
    expect(slot.inspection.rpcCalls.some(call => call.method === 'connectors.set')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});
test('a failed restart keeps access off and shows the failure', async () => {
  const slot = render(false, true);
  try {
    await slot.findByText('Off at launch');
    fireEvent.click(slot.getByRole('switch'));
    expect((await slot.findByRole('alert')).textContent).toContain('Could not stop session');
    expect(slot.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  } finally { slot.lifecycle.unmount(); }
});

test('a draft shows the off default and cannot change another thread access', async () => {
  const slot = render(false, false, null);
  try {
    await slot.findByText('New threads start off. Enable access after creating the thread.');
    const toggle = slot.getByRole('switch');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    fireEvent.click(toggle);
    expect(slot.inspection.rpcCalls.some(call => call.method === 'connectors.set')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});
