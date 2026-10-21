// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountCommitLinks } from './chat-links.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const chat = (text: string, thread = 'thr_example') => `<div data-timeline-row-id="${thread}:assistant:1"><div data-markdown-preview>${text}</div></div>`;

it('opens the hash in its message thread with pointer and keyboard', () => {
  document.body.innerHTML = chat('<code>a12bc345</code>') + chat('<code>ABC1234</code>', 'thr_other');
  const requests: unknown[] = [];
  dispose = mountCommitLinks(document, request => requests.push(request));
  const hashes = document.querySelectorAll<HTMLElement>('code');
  expect(hashes[0]?.getAttribute('role')).toBe('button');
  expect(hashes[0]?.tabIndex).toBe(0);
  hashes[0]?.click();
  hashes[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(requests).toEqual([{ threadId: 'thr_example', sha: 'a12bc345' }, { threadId: 'thr_other', sha: 'abc1234' }]);
});

it('ignores commands, blocks, links, numbers, non-chat code and unknown row formats', () => {
  document.body.innerHTML = chat('<code>git show a12bc345</code><pre><code>a12bc345</code></pre><a href="/file"><code>a12bc345</code></a><code>12345678</code><code>abcdef</code><code>abcdefg</code>')
    + '<code>a12bc345</code>' + chat('<code>a12bc345</code>', 'unknown');
  dispose = mountCommitLinks(document, () => { throw new Error('Unexpected open'); });
  expect(document.querySelectorAll('[role="button"]')).toHaveLength(0);
});

it('follows streamed edits and row reuse, then restores attributes on disposal', async () => {
  document.body.innerHTML = chat('<code title="Original">abc</code>');
  const requests: unknown[] = [];
  dispose = mountCommitLinks(document, request => requests.push(request));
  const code = document.querySelector('code')!;
  code.textContent = 'a12bc345';
  await settle();
  expect(code.title).toContain('Git Glance');
  document.querySelector('[data-timeline-row-id]')?.setAttribute('data-timeline-row-id', 'thr_next:assistant:2');
  code.click();
  expect(requests).toEqual([{ threadId: 'thr_next', sha: 'a12bc345' }]);
  code.textContent = 'a12bc345 command';
  await settle();
  expect(code.getAttribute('role')).toBeNull();
  expect(code.title).toBe('Original');
  code.textContent = 'b12bc345';
  await settle();
  dispose?.();
  expect(code.title).toBe('Original');
  expect(code.getAttribute('tabindex')).toBeNull();
  expect(code.classList.contains('gg-chat-commit')).toBe(false);
  code.click();
  expect(requests).toHaveLength(1);
  code.textContent = 'c12bc345';
  await settle();
  expect(code.getAttribute('role')).toBeNull();
});

it('preserves text selection and modified clicks', () => {
  document.body.innerHTML = chat('<code>a12bc345</code>');
  const requests: unknown[] = [];
  dispose = mountCommitLinks(document, request => requests.push(request));
  const code = document.querySelector('code')!;
  code.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
  const range = document.createRange();
  range.selectNodeContents(code);
  document.getSelection()?.addRange(range);
  code.click();
  document.getSelection()?.removeAllRanges();
  expect(requests).toHaveLength(0);
  code.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(requests).toHaveLength(1);
});

it('decorates new rows and releases detached nodes without replacing their text', async () => {
  const requests: unknown[] = [];
  dispose = mountCommitLinks(document, request => requests.push(request));
  document.body.innerHTML = chat('<code>a12bc345</code><code role="link" tabindex="0">b12bc345</code>');
  const code = document.querySelector('code')!;
  const text = code.firstChild;
  await settle();
  expect(code.firstChild).toBe(text);
  expect(document.querySelectorAll('.gg-chat-commit')).toHaveLength(1);
  document.body.replaceChildren();
  await settle();
  code.click();
  expect(requests).toHaveLength(0);
  expect(code.getAttribute('role')).toBeNull();
});
