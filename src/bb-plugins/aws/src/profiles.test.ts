import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProfiles, regionConfig, REGION_PATTERN } from './profiles.ts';

test('reads profile names and regions, skipping non-profile sections', () => {
  const text = `
[default]
region = eu-west-1

[sso-session acme]
sso_region = us-east-1
region = us-east-1

# a comment
[profile acme-dev]
sso_session = acme
sso_account_id = 111111111111
region=eu-west-2

[profile  acme-prod/ReadOnly ]
granted_sso_role_name = ReadOnly

[services local]
region = us-west-2
`;
  assert.deepEqual(parseProfiles(text), [
    { name: 'default', region: 'eu-west-1' },
    { name: 'acme-dev', region: 'eu-west-2' },
    { name: 'acme-prod/ReadOnly', region: null },
  ]);
});

test('region config holds only a region', () => {
  assert.equal(regionConfig('eu-west-1'), '[default]\nregion = eu-west-1\n');
  assert.equal(regionConfig(null), '');
});

test('region names', () => {
  for (const ok of ['eu-west-1', 'us-gov-west-1', 'ap-southeast-2']) assert.ok(REGION_PATTERN.test(ok), ok);
  for (const bad of ['eu-west', 'EU-WEST-1', 'eu-west-1\n[profile x]', '']) assert.ok(!REGION_PATTERN.test(bad), bad);
});
