import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentAmpUsage } from './amp-presentation.ts';

test('formats the native account and credit reading without terminal boilerplate', () => {
  assert.deepEqual(presentAmpUsage('Signed in as member@example.com\nIndividual credits: $9.81 remaining (set up auto-reload to avoid running out) - https://ampcode.com/settings'), {
    account: 'member@example.com', balances: [{ label: 'Individual credits', amount: '$9.81' }],
    settingsUrl: 'https://ampcode.com/settings', details: [],
  });
});
test('keeps both individual and workspace balances, including zero and grouped amounts', () => {
  assert.deepEqual(presentAmpUsage('Individual credits: $0.00 remaining\nWorkspace credits: $1,250.50 remaining').balances,
    [{ label: 'Individual credits', amount: '$0.00' }, { label: 'Workspace credits', amount: '$1,250.50' }]);
});
test('keeps unknown provider output and warnings without inventing an account or balance', () => {
  assert.deepEqual(presentAmpUsage('Monthly allowance: 12 left\nBilling is suspended.'), {
    account: null, balances: [], settingsUrl: null, details: ['Monthly allowance: 12 left', 'Billing is suspended.'],
  });
  assert.deepEqual(presentAmpUsage('Individual credits: $9.81 remaining - Billing is suspended.').details, ['Billing is suspended.']);
});
test('recognises a settings URL on a separate line and never turns arbitrary text into a link', () => {
  assert.equal(presentAmpUsage('Individual credits: $9.81 remaining\nhttps://ampcode.com/settings').settingsUrl, 'https://ampcode.com/settings');
  assert.deepEqual(presentAmpUsage('https://example.com/settings').details, ['https://example.com/settings']);
  assert.deepEqual(presentAmpUsage('javascript:alert(1)').details, ['javascript:alert(1)']);
});
