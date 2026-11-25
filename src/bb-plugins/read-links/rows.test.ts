// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { ExperimentalFileOpenOptions } from '@get-bb/plugin-sdk/app';
import { mountReadLinks } from './rows';
import { addNavigator, getWanted, resetStore, setHost, setTargets } from './store';

// Mirrors BB 0.50.1 markup: a row, a title view with a prefix and a truncating file segment.
const title = (prefix: string, file: string) =>
  `<span title="${prefix} ${file}"><span class="shrink-0">${prefix}</span> <span class="min-w-0 truncate">${file}</span></span>`;
const row = (id: string, inner: string) => `<div data-timeline-row-id="${id}">${inner}</div>`;
// The observer queues its sync timer after a same-tick timeout, so wait past it.
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

let dispose: (() => void) | undefined;
type Open = (options: ExperimentalFileOpenOptions) => boolean;
let open: Mock<Open>;
beforeEach(() => {
  resetStore();
  open = vi.fn<Open>(() => true);
  setHost('t', 'host_1');
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

function mountWithNavigator(html: string) {
  document.body.innerHTML = `<main id="pane">${html}<span id="anchor" hidden></span></main>`;
  addNavigator({ anchor: document.getElementById('anchor')!, navigate: { experimental_openFilePreview: open } });
  dispose = mountReadLinks(document);
}

it('opens the file and stops the row toggling', async () => {
  setTargets(new Map([['t:file-read:1', ['/a/notes.md']]]));
  mountWithNavigator(row('t:file-read:1', `<button id="toggle">${title('Read file', 'notes.md')}</button>`));
  const toggle = vi.fn();
  document.getElementById('toggle')!.addEventListener('click', toggle);
  const link = document.querySelector<HTMLElement>('.bb-read-link')!;
  expect(link.textContent).toBe('notes.md');
  expect(link.getAttribute('role')).toBe('link');
  link.click();
  expect(open).toHaveBeenCalledWith({ target: { kind: 'host', hostId: 'host_1', path: '/a/notes.md' }, location: null });
  expect(toggle).not.toHaveBeenCalled();
});

it('keeps BB behaviour for modifier clicks, the prefix and refused previews', () => {
  setTargets(new Map([['t:file-read:1', ['/a/notes.md']]]));
  mountWithNavigator(row('t:file-read:1', `<button id="toggle">${title('Read file', 'notes.md')}</button>`));
  const toggle = vi.fn();
  document.getElementById('toggle')!.addEventListener('click', toggle);
  const link = document.querySelector<HTMLElement>('.bb-read-link')!;
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
  document.querySelector<HTMLElement>('.shrink-0')!.click();
  open.mockReturnValue(false);
  link.click();
  expect(toggle).toHaveBeenCalledTimes(3);
});

it('opens with Enter', () => {
  setTargets(new Map([['t:file-read:1', ['/a/notes.md']]]));
  mountWithNavigator(row('t:file-read:1', title('Read file', 'notes.md')));
  document.querySelector('.bb-read-link')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(open).toHaveBeenCalledOnce();
});

it('links each title of a multi-file command to its own file', () => {
  setTargets(new Map([['t:command:1', ['/w/a.ts', null, '/w/b.ts']]]));
  mountWithNavigator(row('t:command:1', title('Read', 'a.ts') + title('Listed', 'src') + title('Read', 'b.ts')));
  const links = Array.from(document.querySelectorAll<HTMLElement>('.bb-read-link'));
  expect(links.map(link => link.textContent)).toEqual(['a.ts', 'b.ts']);
  links[1].click();
  expect(open.mock.calls[0][0].target.path).toBe('/w/b.ts');
});

it('leaves a row alone when BB renders a different number of titles', () => {
  setTargets(new Map([['t:command:1', ['/w/a.ts', '/w/b.ts']]]));
  mountWithNavigator(row('t:command:1', title('Exploring', '2 files')));
  expect(document.querySelector('.bb-read-link')).toBeNull();
});

it('ignores titles belonging to nested rows', () => {
  setTargets(new Map([['t:work-summary:1', ['/never']], ['t:file-read:2', ['/x']]]));
  mountWithNavigator(row('t:work-summary:1', row('t:file-read:2', title('Read file', 'x'))));
  expect(document.querySelectorAll('.bb-read-link')).toHaveLength(1);
});

it('requests unknown read rows and links them once their targets arrive', async () => {
  mountWithNavigator(row('t:file-read:1', title('Read file', 'notes.md')) + row('t:message:2', title('Said', 'hi')));
  expect([...getWanted()]).toEqual(['t:file-read:1']);
  setTargets(new Map([['t:file-read:1', ['/a/notes.md']]]));
  await settle();
  expect(document.querySelector('.bb-read-link')?.textContent).toBe('notes.md');
});

it('decorates rows that stream in later', async () => {
  setTargets(new Map([['t:file-read:1', ['/a/notes.md']]]));
  mountWithNavigator('');
  document.getElementById('pane')!.insertAdjacentHTML('afterbegin', row('t:file-read:1', title('Read file', 'notes.md')));
  await settle();
  expect(document.querySelector('.bb-read-link')).not.toBeNull();
});

it('uses the navigator from the clicked row\'s own pane', () => {
  setTargets(new Map([['t:file-read:1', ['/a']], ['t:file-read:2', ['/b']]]));
  document.body.innerHTML = `<div id="left">${row('t:file-read:1', title('Read file', 'a'))}<span id="l" hidden></span></div>`
    + `<div id="right">${row('t:file-read:2', title('Read file', 'b'))}<span id="r" hidden></span></div>`;
  const left = vi.fn<Open>(() => true); const right = vi.fn<Open>(() => true);
  addNavigator({ anchor: document.getElementById('l')!, navigate: { experimental_openFilePreview: left } });
  addNavigator({ anchor: document.getElementById('r')!, navigate: { experimental_openFilePreview: right } });
  dispose = mountReadLinks(document);
  document.querySelectorAll<HTMLElement>('.bb-read-link')[1].click();
  expect(right).toHaveBeenCalledOnce();
  expect(left).not.toHaveBeenCalled();
});

it('removes every decoration on disposal', () => {
  setTargets(new Map([['t:file-read:1', ['/a/notes.md']]]));
  mountWithNavigator(row('t:file-read:1', title('Read file', 'notes.md')));
  const segment = document.querySelector<HTMLElement>('.bb-read-link')!;
  dispose!(); dispose = undefined;
  expect(segment.className).toBe('min-w-0 truncate');
  expect(segment.hasAttribute('role') || segment.hasAttribute('tabindex') || segment.hasAttribute('title')).toBe(false);
  segment.click();
  expect(open).not.toHaveBeenCalled();
});
