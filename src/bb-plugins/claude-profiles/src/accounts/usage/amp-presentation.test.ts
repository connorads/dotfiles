import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentAmpUsage } from './amp-presentation.ts';

test('formats Markdown balances and removes recognised billing help while preserving warnings', () => {
  const text = `Signed in as member@example.com
**Individual credits:** $9.81 remaining (set up auto-reload to avoid running out) - https://ampcode.com/settings
**Workspace credits:** $0.00 remaining

## How Usage Is Charged
- Models served by Amp: the token list price.
- Models served by your own provider connections: no Amp fee. The provider bills that inference directly.
- Amp-hosted orbs: the standard orb price (https://ampcode.com/docs/orbs/sizes-and-costs).
- Self-hosted orbs: free.
- Everything else, such as web search: its list price.
- Billing is suspended.
# Run \`amp usage --details\` for more detailed information.
## Account notice
Payment method expires soon.`;
  assert.deepEqual(presentAmpUsage(text), {
    account: 'member@example.com',
    balances: [{ label: 'Individual credits', amount: '$9.81' }, { label: 'Workspace credits', amount: '$0.00' }],
    settingsUrl: 'https://ampcode.com/settings',
    details: ['- Billing is suspended.', '## Account notice', 'Payment method expires soon.'],
  });
});

test('preserves billing-like text outside the recognised help section', () => {
  assert.deepEqual(presentAmpUsage('- Self-hosted orbs: free.').details, ['- Self-hosted orbs: free.']);
});

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
