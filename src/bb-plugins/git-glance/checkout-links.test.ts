// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountCheckoutLinks, parseCheckoutReference } from './checkout-links.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });
const reference = 'git-checkout://host_example/trees/review%20tree';
const chat = (content: string) => `<div data-timeline-row-id="thr_example:assistant:1"><div data-markdown-preview>${content}</div></div>`;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('parses an explicit host and absolute path, without accepting extra URL actions', () => {
  expect(parseCheckoutReference(reference)).toEqual({ hostId: 'host_example', path: '/trees/review tree' });
  for (const value of ['git show HEAD', 'git-checkout:///trees/app', `${reference}?push=true`, `${reference}#HEAD`,
    'git-checkout://user@host_example/trees/app', 'git-checkout://host_example:80/trees/app',
    'git-checkout://host_example/trees/%00', 'git-checkout://host_example/trees/%ZZ']) {
    expect(parseCheckoutReference(value)).toBeNull();
  }
});

it('opens an explicit reference in its message thread with pointer and keyboard', () => {
  document.body.innerHTML = chat(`<code>${reference}</code>`);
  const requests: unknown[] = [];
  dispose = mountCheckoutLinks(document, request => requests.push(request));
  const code = document.querySelector('code')!;
  expect(code.getAttribute('role')).toBe('button');
  code.click();
  code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(requests).toEqual(Array(2).fill({ threadId: 'thr_example', hostId: 'host_example', path: '/trees/review tree' }));
});

it('leaves blocks, links, commands, modified clicks and text selection alone', () => {
  document.body.innerHTML = chat(`<pre><code>${reference}</code></pre><a href="/file"><code>${reference}</code></a><code>echo ${reference}</code><code>${reference}</code>`);
  const requests: unknown[] = [];
  dispose = mountCheckoutLinks(document, request => requests.push(request));
  expect(document.querySelectorAll('[role="button"]')).toHaveLength(1);
  const code = document.querySelector<HTMLElement>('[role="button"]')!;
  code.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
  const range = document.createRange(); range.selectNodeContents(code);
  document.getSelection()?.addRange(range); code.click(); document.getSelection()?.removeAllRanges();
  expect(requests).toHaveLength(0);
});

it('follows streamed references and row reuse, then restores the original attributes', async () => {
  document.body.innerHTML = chat('<code title="Original">draft</code>');
  const requests: unknown[] = [];
  dispose = mountCheckoutLinks(document, request => requests.push(request));
  const code = document.querySelector('code')!;
  code.textContent = reference; await settle();
  expect(code.tabIndex).toBe(0);
  document.querySelector('[data-timeline-row-id]')?.setAttribute('data-timeline-row-id', 'thr_other:assistant:2');
  code.click();
  expect(requests).toEqual([{ threadId: 'thr_other', hostId: 'host_example', path: '/trees/review tree' }]);
  code.textContent = 'draft'; await settle();
  expect(code.title).toBe('Original'); expect(code.getAttribute('role')).toBeNull();
  code.textContent = reference; await settle(); dispose?.();
  expect(code.title).toBe('Original'); expect(code.getAttribute('tabindex')).toBeNull();
  code.click(); expect(requests).toHaveLength(1);
});
