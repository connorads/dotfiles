// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountFileHistory } from './history';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); window.history.replaceState(null, '', '/'); });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

function fixture() {
  document.body.innerHTML = `<div data-panel-id="thread-detail-secondary-panel"><aside aria-hidden="false">
    <div data-secondary-panel-tab-content></div>
    <div data-file-preview-scroll-container><div><div><div><button aria-label="Copy file path"></button></div></div></div></div>
  </aside></div><button id="outside">Outside</button>`;
  const strip = document.querySelector('[data-secondary-panel-tab-content]');
  const path = document.querySelector('[aria-label="Copy file path"]');
  if (!strip || !path) throw new Error('Missing fixture');
  const tabs = ['catalogue.md', 'guide.md', 'guide.md'].map((name, index) => {
    const button = document.createElement('button');
    button.innerHTML = `<svg data-icon="File"></svg>${name}`;
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab === button));
      path.textContent = `section-${index}/${name}`;
    };
    strip.append(button);
    return button;
  });
  const visit = async (index: number) => { tabs[index]?.click(); await settle(); };
  const control = (name: string) => {
    const button = document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`);
    if (!button) throw new Error(`Missing ${name}`);
    return button;
  };
  return { tabs, path, visit, control };
}

it('returns to visited files, including identically named tabs, and branches after Back', async () => {
  const { tabs, visit, control } = fixture();
  await visit(0);
  dispose = mountFileHistory(document);
  expect(control('Previous file').disabled).toBe(true);
  await visit(1);
  await visit(2);
  control('Previous file').click();
  await settle();
  expect(tabs[1]?.getAttribute('aria-pressed')).toBe('true');
  control('Previous file').click();
  await settle();
  expect(tabs[0]?.getAttribute('aria-pressed')).toBe('true');
  control('Next file').click();
  await settle();
  expect(tabs[1]?.getAttribute('aria-pressed')).toBe('true');
  await visit(0);
  expect(control('Next file').disabled).toBe(true);
});

it('handles one mouse navigation per press only inside the visible file panel', async () => {
  const { tabs, path, visit, control } = fixture();
  await visit(0);
  dispose = mountFileHistory(document);
  await visit(1);
  await visit(2);
  for (const type of ['mousedown', 'mouseup', 'auxclick']) {
    const event = new MouseEvent(type, { button: 3, bubbles: true, cancelable: true });
    path.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await settle();
  }
  expect(tabs[1]?.getAttribute('aria-pressed')).toBe('true');
  path.dispatchEvent(new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true }));
  await settle();
  expect(tabs[2]?.getAttribute('aria-pressed')).toBe('true');
  const outside = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  document.querySelector('#outside')?.dispatchEvent(outside);
  expect(outside.defaultPrevented).toBe(false);
  control('Previous file').click();
  await settle();
  control('Previous file').click();
  await settle();
  const boundary = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  path.dispatchEvent(boundary);
  expect(boundary.defaultPrevented).toBe(true);
});

it('prunes closed tabs, resets on route changes and removes controls on disposal', async () => {
  const { tabs, visit, control } = fixture();
  await visit(0);
  dispose = mountFileHistory(document);
  await visit(1);
  await visit(2);
  tabs[1]?.remove();
  await settle();
  control('Previous file').click();
  await settle();
  expect(tabs[0]?.getAttribute('aria-pressed')).toBe('true');
  window.history.replaceState(null, '', '/another-thread');
  await visit(2);
  expect(control('Previous file').disabled).toBe(true);
  dispose();
  expect(document.querySelector('.bb-file-history')).toBeNull();
  const event = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  tabs[0]?.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('reattaches controls after a preview redraw and ignores hidden or non-file panels', async () => {
  const { path, visit, control } = fixture();
  await visit(0);
  dispose = mountFileHistory(document);
  await visit(1);
  const header = path.parentElement?.parentElement;
  if (!header) throw new Error('Missing header');
  header.replaceChildren(path.parentElement ?? path);
  await settle();
  expect(document.querySelectorAll('.bb-file-history')).toHaveLength(1);
  expect(control('Previous file').disabled).toBe(false);
  const aside = document.querySelector('aside');
  aside?.setAttribute('aria-hidden', 'true');
  await settle();
  expect(document.querySelector('.bb-file-history')).toBeNull();
  const hidden = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  path.dispatchEvent(hidden);
  expect(hidden.defaultPrevented).toBe(false);
  aside?.setAttribute('aria-hidden', 'false');
  await settle();
  path.remove();
  await settle();
  const outsidePreview = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  aside?.dispatchEvent(outsidePreview);
  expect(outsidePreview.defaultPrevented).toBe(false);
});
