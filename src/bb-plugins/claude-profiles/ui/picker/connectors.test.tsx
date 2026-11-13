// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { ConnectorState, connectorsContract } from '../../src/accounts/connectors-contract.ts';
import type { Profile } from '../../contracts.ts';
import { AccountConnectors } from './connectors.tsx';

function render(disabled = false, fail = false, threadId: string | null = 't1') {
  let state: ConnectorState = { enabled: false, launch: 'off', mode: 'account',
    accounts: { default: false }, profileId: 'default', restartPending: false };
  return renderSlot<{ threadId: string | null; disabled: boolean; profiles: Profile[] }, typeof connectorsContract>(
    { component: AccountConnectors }, { threadId, disabled, profiles: [{ id: 'default', label: 'Default', configDir: null }] }, {
      rpc: {
        'connectors.get': () => state,
        'connectors.set': input => { state = { ...state, mode: input.mode, enabled: input.mode === 'account', launch: 'pending' }; return state; },
        'connectors.account.set': input => {
          if (fail) throw new Error('Could not save account policy');
          state = { ...state, accounts: { default: input.enabled }, enabled: input.enabled, launch: 'pending', restartPending: true };
          return { restarted: 0 };
        },
      },
    });
}
test('account opt-in shows that a running session changes when its turn ends, without submitting a message', async () => {
  const slot = render();
  try {
    const toggle = await slot.findByRole('switch', { name: 'Default account connectors' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle);
    await slot.findByText(/Applies when this turn ends/);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});
test('a draft can configure its account without changing a consumable thread choice', async () => {
  const slot = render(false, false, null);
  try {
    const toggle = await slot.findByRole('switch', { name: 'Default account connectors' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle);
    await slot.findByText(/On for this account/);
    expect(slot.queryByRole('combobox')).toBeNull();
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'connectors.account.set').map(call => call.input))
      .toEqual([{ threadId: null, profileId: 'default', enabled: true }]);
  } finally { slot.lifecycle.unmount(); }
});
test('a failed policy update keeps the account off and shows the error', async () => {
  const slot = render(false, true);
  try {
    const toggle = await slot.findByRole('switch', { name: 'Default account connectors' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle);
    expect((await slot.findByRole('alert')).textContent).toContain('Could not save account policy');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  } finally { slot.lifecycle.unmount(); }
});
