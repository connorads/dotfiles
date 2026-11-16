const prefix = 'acp-antigravity-profile-';
export function antigravityAccountId(providerId: string): string | null {
  if (providerId === 'acp-antigravity') return 'default';
  const id = providerId.startsWith(prefix) ? providerId.slice(prefix.length) : '';
  return /^[a-z][a-z0-9-]{0,31}$/u.test(id) && id !== 'default' ? id : null;
}
export function antigravityProviderId(accountId: string): string {
  if (accountId === 'default') return 'acp-antigravity';
  const provider = `${prefix}${accountId}`;
  if (antigravityAccountId(provider) === null) throw new Error('Invalid Antigravity account.');
  return provider;
}
