// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { mountAccountBadges } from './rows.ts';
import { setBadges } from './store.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); setBadges([]); document.body.replaceChildren(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// Mirrors the bundled thread list: the row link and the provider icon are siblings.
const row = (threadId: string, providerId: string) => `<div><a data-sidebar-thread-id="${threadId}"></a>`
  + `<span><span data-sidebar-thread-provider="${providerId}"><svg></svg></span><span>Title</span></span></div>`;
const badge = (threadId: string) => document.querySelector(`[data-sidebar-thread-id="${threadId}"]`)
  ?.parentElement?.querySelector<HTMLElement>('.cp-row-badge');

test('badges Claude rows bound to a named account with its initial and name', () => {
  document.body.innerHTML = row('t1', 'claude-code') + row('t2', 'claude-code') + row('t3', 'codex');
  setBadges([{ threadId: 't1', profileId: 'alpha', label: 'alpha' }, { threadId: 't3', profileId: 'beta', label: 'beta' }]);
  dispose = mountAccountBadges(document);
  expect(badge('t1')?.textContent).toBe('A');
  expect(badge('t1')?.title).toBe('Claude account: alpha');
  expect(badge('t1')?.parentElement?.dataset.sidebarThreadProvider).toBe('claude-code');
  expect(badge('t2')).toBeNull();
  expect(badge('t3')).toBeNull();
});

test('follows account switches and rows rendered later, and cleans up on dispose', async () => {
  document.body.innerHTML = row('t1', 'claude-code');
  dispose = mountAccountBadges(document);
  setBadges([{ threadId: 't1', profileId: 'beta', label: 'beta' }]);
  expect(badge('t1')?.textContent).toBe('B');
  setBadges([{ threadId: 't1', profileId: 'alpha', label: 'alpha' }]);
  expect(badge('t1')?.textContent).toBe('A');
  document.body.insertAdjacentHTML('beforeend', row('t2', 'claude-code'));
  setBadges([{ threadId: 't1', profileId: 'alpha', label: 'alpha' }, { threadId: 't2', profileId: 'stretch', label: 'stretch' }]);
  await settle();
  expect(badge('t2')?.textContent).toBe('S');
  setBadges([{ threadId: 't2', profileId: 'stretch', label: 'stretch' }]);
  expect(badge('t1')).toBeNull();
  dispose();
  dispose = undefined;
  expect(document.querySelectorAll('.cp-row-badge')).toHaveLength(0);
});

test('re-adds a badge when the list re-renders the provider icon', async () => {
  document.body.innerHTML = row('t1', 'claude-code');
  setBadges([{ threadId: 't1', profileId: 'alpha', label: 'alpha' }]);
  dispose = mountAccountBadges(document);
  document.body.innerHTML = row('t1', 'claude-code');
  await settle();
  expect(badge('t1')?.textContent).toBe('A');
});

test('gives each account a stable colour', () => {
  document.body.innerHTML = row('t1', 'claude-code') + row('t2', 'claude-code') + row('t3', 'claude-code');
  setBadges([{ threadId: 't1', profileId: 'beta', label: 'beta' }, { threadId: 't2', profileId: 'beta', label: 'beta' },
    { threadId: 't3', profileId: 'alpha', label: 'alpha' }]);
  dispose = mountAccountBadges(document);
  expect(badge('t1')?.style.backgroundColor).toBe(badge('t2')?.style.backgroundColor);
  expect(badge('t1')?.style.backgroundColor).not.toBe(badge('t3')?.style.backgroundColor);
});
