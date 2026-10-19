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
  expect(anchor.querySelector('.bb-destination-icon')).not.toBeNull();
  expect(document.querySelectorAll('.bb-destination-icon')).toHaveLength(1);
  anchor.click();
  expect(click).toHaveBeenCalledOnce();
  expect(anchor.getAttribute('href')).toBe('file:///tmp/a');
  dispose();
  expect(anchor.querySelector('.bb-file-preview-original')).toBeNull();
  expect(document.querySelectorAll('.bb-destination-icon')).toHaveLength(0);
});

it('handles streamed replacement icons and stops decorating after disposal', async () => {
  document.body.innerHTML = '<div data-timeline-row-id="1"><div data-markdown-preview><a href="file:///tmp/a"><svg class="inline" data-icon="ExternalLink"></svg></a></div></div>';
  dispose = mountFileIcons(document);
  const anchor = document.querySelector('a')!;
  anchor.innerHTML = '<svg class="inline" data-icon="ExternalLink"></svg>';
  await settle();
  expect(anchor.querySelectorAll('.bb-destination-icon')).toHaveLength(1);
  anchor.href = 'https://example.com';
  await settle();
  expect(anchor.querySelector('.bb-destination-icon')).toBeNull();
  expect(anchor.querySelector('.bb-file-preview-original')).toBeNull();
  dispose();
  anchor.href = 'file:///tmp/a';
  await settle();
  expect(anchor.querySelector('.bb-destination-icon')).toBeNull();
});

it('normalises labelled preview, browser and editor actions without changing native behaviour', () => {
  document.body.innerHTML = `<div data-timeline-row-id="a"><a aria-label="Open demo.html in sidebar" href="/demo"><svg data-icon="Maximize2" class="size-3"></svg></a></div>
    <button aria-label="Open in external browser"><svg data-icon="Globe"></svg></button>
    <div role="menuitem">Open in editor<svg data-icon="ExternalLink"></svg></div>
    <button aria-label="Open in editor (VS Code)"><svg data-icon="VSCode"></svg></button>
    <button aria-label="Expand"><svg data-icon="Maximize2"></svg></button>
    <button aria-label="Open in external browser"><svg data-icon="ExternalLink"></svg></button>`;
  const action = document.querySelector('a')!;
  const handler = vi.fn((event: Event) => event.preventDefault());
  action.addEventListener('click', handler);
  dispose = mountFileIcons(document);
  expect(document.querySelectorAll('.bb-destination-icon')).toHaveLength(3);
  expect(action.querySelector('.bb-destination-icon')?.classList.contains('size-3')).toBe(true);
  action.dispatchEvent(new MouseEvent('click', { metaKey: true, cancelable: true }));
  expect(handler).toHaveBeenCalledOnce();
  expect(action.getAttribute('href')).toBe('/demo');
  dispose();
  expect(document.querySelectorAll('.bb-destination-icon')).toHaveLength(0);
  expect(document.querySelectorAll('.bb-file-preview-original')).toHaveLength(0);
});
