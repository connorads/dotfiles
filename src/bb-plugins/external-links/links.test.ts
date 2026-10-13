// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountExternalLinks } from './links';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it('adds a separate accessible action without intercepting ordinary links', () => {
  document.body.innerHTML = '<div data-timeline-row-id="1"><div data-markdown-preview><a href="https://example.com">Example</a><a href="/projects/1">Thread</a><a href="file:///tmp/a">File</a></div></div><a href="https://example.org">Outside chat</a>';
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  dispose = mountExternalLinks(document);
  const buttons = document.querySelectorAll('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.getAttribute('aria-label')).toBe('Open Example in external browser');
  expect(document.querySelector('a')?.textContent).toBe('Example');
  buttons[0]?.click();
  expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/', '_blank', 'noopener,noreferrer');
});

it('decorates streamed links, follows URL edits, and cleans up on disable', async () => {
  document.body.innerHTML = '<div data-timeline-row-id="1"><div data-markdown-preview></div></div>';
  dispose = mountExternalLinks(document);
  const markdown = document.querySelector('[data-markdown-preview]')!;
  markdown.innerHTML = '<a href="https://example.com">Example</a>';
  await settle();
  expect(document.querySelectorAll('button')).toHaveLength(1);
  const anchor = document.querySelector('a')!;
  anchor.href = 'https://example.org';
  anchor.textContent = 'Changed';
  await settle();
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  document.querySelector('button')?.click();
  expect(open).toHaveBeenCalledWith('https://example.org/', '_blank', 'noopener,noreferrer');
  expect(document.querySelector('button')?.getAttribute('aria-label')).toContain('Changed');
  dispose?.();
  expect(document.querySelectorAll('button')).toHaveLength(0);
  anchor.href = 'https://example.net';
  await settle();
  expect(document.querySelectorAll('button')).toHaveLength(0);
});

it('removes the button when a link becomes internal or disappears', async () => {
  document.body.innerHTML = '<div data-timeline-row-id="1"><div data-markdown-preview><a href="https://example.com">Example</a></div></div>';
  dispose = mountExternalLinks(document);
  document.querySelector('a')!.setAttribute('href', '/projects/1');
  await settle();
  expect(document.querySelectorAll('button')).toHaveLength(0);
  document.querySelector('a')!.setAttribute('href', 'https://example.com');
  await settle();
  expect(document.querySelectorAll('button')).toHaveLength(1);
  document.querySelector('a')!.remove();
  await settle();
  expect(document.querySelectorAll('button')).toHaveLength(0);
});
