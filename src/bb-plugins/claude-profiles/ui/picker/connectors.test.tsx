// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { ConnectorState, connectorsContract } from '../../src/accounts/connectors-contract.ts';
import type { Profile } from '../../contracts.ts';
import { AccountConnectors } from './connectors.tsx';

function render(disabled = false, fail = false, threadId: string | null = 't1') {
  let state: ConnectorState = { enabled: false, launch: 'off', mode: 'account', globalBlocked: false,
    accounts: { default: false }, profileId: 'default', pending: 0 };
  return renderSlot<{ threadId: string | null; disabled: boolean; profiles: Profile[] }, typeof connectorsContract>(
    { component: AccountConnectors }, { threadId, disabled, profiles: [{ id: 'default', label: 'Default', configDir: null }] }, {
      rpc: {
        'connectors.get': () => state,
        'connectors.set': input => { state = { ...state, mode: input.mode, enabled: input.mode === 'account', launch: 'pending' }; return state; },
        'connectors.global.set': input => { state = { ...state, globalBlocked: input.blocked, enabled: false }; return { pending: 0 }; },
        'connectors.account.set': input => {
          if (fail) throw new Error('Could not save account policy');
          state = { ...state, accounts: { default: input.enabled }, enabled: input.enabled, launch: 'pending', pending: 1 };
          return { pending: 1 };
        },
        'connectors.restart': () => { state = { ...state, pending: 0 }; return { pending: 0 }; },
      },
    });
}
test('account opt-in shows pending sessions and an explicit stop action without submitting a message', async () => {
  const slot = render();
  try {
    const toggle = await slot.findByRole('switch', { name: 'Default account connectors' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle);
    await slot.findByText(/1 sessions still need a restart/);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(slot.getByRole('button', { name: 'Stop pending sessions now' }));
    await waitFor(() => expect(slot.queryByRole('button', { name: 'Stop pending sessions now' })).toBeNull());
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});
test('global block states its precedence while keeping account preferences editable', async () => {
  const slot = render();
  try {
    const toggle = await slot.findByRole('switch', { name: 'Allow account connectors in BB' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle);
    await slot.findByText(/Blocked globally/);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(slot.getByRole('switch', { name: 'Default account connectors' }).hasAttribute('disabled')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});
test('thread controls only offer account settings or off and are disabled during a turn', async () => {
  const slot = render(true);
  try {
    await slot.findByText(/Off for this account/);
    const control = slot.getByRole('combobox', { name: "This thread's connectors" });
    expect(control.hasAttribute('disabled')).toBe(true);
    expect(slot.getAllByRole('option').map(option => option.textContent)).toEqual(['Use account setting', 'Off']);
  } finally { slot.lifecycle.unmount(); }
});
test('a draft can configure its account without changing a consumable thread choice', async () => {
  const slot = render(false, false, null);
  try {
    const toggle = await slot.findByRole('switch', { name: 'Default account connectors' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle);
    await slot.findByText(/Allowed by account settings/);
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
