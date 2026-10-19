// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountFileIcons } from './files';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it('distinguishes file previews without changing their link or click handler', () => {
  document.body.innerHTML = '<div data-timeline-row-id="1"><div data-markdown-preview><a href="file:///tmp/a"><span>File<svg class="inline" data-icon="ExternalLink"></svg></span></a><a href="https://example.com"><svg class="inline" data-icon="ExternalLink"></svg></a><a href="file:///tmp/b"><svg data-icon="VSCode"></svg></a><a href="file:///tmp/c"><span><svg data-icon="ExternalLink"></svg></span></a></div></div>';
  const anchor = document.querySelector('a')!;
  const click = vi.fn((event: Event) => event.preventDefault());
  anchor.addEventListener('click', click);
  dispose = mountFileIcons(document);
  expect(anchor.querySelector('.bb-file-preview-icon')).not.toBeNull();
  expect(document.querySelectorAll('.bb-file-preview-icon')).toHaveLength(1);
  anchor.click();
  expect(click).toHaveBeenCalledOnce();
  expect(anchor.getAttribute('href')).toBe('file:///tmp/a');
  dispose();
  expect(anchor.querySelector('.bb-file-preview-original')).toBeNull();
  expect(document.querySelectorAll('.bb-file-preview-icon')).toHaveLength(0);
});

it('handles streamed replacement icons and stops decorating after disposal', async () => {
  document.body.innerHTML = '<div data-timeline-row-id="1"><div data-markdown-preview><a href="file:///tmp/a"><svg class="inline" data-icon="ExternalLink"></svg></a></div></div>';
  dispose = mountFileIcons(document);
  const anchor = document.querySelector('a')!;
  anchor.innerHTML = '<svg class="inline" data-icon="ExternalLink"></svg>';
  await settle();
  expect(anchor.querySelectorAll('.bb-file-preview-icon')).toHaveLength(1);
  anchor.href = 'https://example.com';
  await settle();
  expect(anchor.querySelector('.bb-file-preview-icon')).toBeNull();
  expect(anchor.querySelector('.bb-file-preview-original')).toBeNull();
  dispose();
  anchor.href = 'file:///tmp/a';
  await settle();
  expect(anchor.querySelector('.bb-file-preview-icon')).toBeNull();
});
