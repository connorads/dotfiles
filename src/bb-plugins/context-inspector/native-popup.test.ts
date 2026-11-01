// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { mountNativeContextDetails } from './native-popup';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); document.body.replaceChildren(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function markup() {
  document.body.innerHTML = '<section id="pane-a"><button aria-label="Context window 28% used" aria-expanded="true" aria-controls="native-a">Context</button></section><section id="pane-b"><button aria-label="Context window 42% used" aria-expanded="true" aria-controls="native-b">Context</button></section><div id="native-a" role="dialog"><span>Native content</span></div><div id="native-b" role="dialog"><span>Other native content</span></div>';
}
test('adds one action per correctly resolved native popup without changing native content', () => {
  markup(); const inspect = vi.fn();
  cleanup.push(mountNativeContextDetails({ document, resolveThread: trigger => trigger.closest('#pane-a') ? 'thread-a' : 'thread-b', onInspect: inspect }));
  const actions = document.querySelectorAll<HTMLButtonElement>('.ci-native-popup-action');
  expect(actions).toHaveLength(2); actions[1].click(); expect(inspect).toHaveBeenCalledWith('thread-b');
  expect(document.getElementById('native-a')?.textContent).toContain('Native content');
});
test('omits unresolved and ambiguously shared popup ownership', () => {
  markup(); document.querySelector('#pane-b button')?.setAttribute('aria-controls', 'native-a');
  cleanup.push(mountNativeContextDetails({ document, resolveThread: trigger => trigger.closest('#pane-a') ? 'thread-a' : 'thread-b', onInspect: vi.fn() }));
  expect(document.querySelector('.ci-native-popup-action')).toBeNull();
});
test('adds after native redraw and removes actions on close and disposal', async () => {
  markup(); const dispose = mountNativeContextDetails({ document, resolveThread: () => 'thread-a', onInspect: vi.fn() }); cleanup.push(dispose);
  document.getElementById('native-a')?.replaceChildren(document.createTextNode('Redrawn native content'));
  await flush(); expect(document.querySelectorAll('.ci-native-popup-action')).toHaveLength(2);
  document.querySelector('#pane-a button')?.setAttribute('aria-expanded', 'false');
  await flush(); expect(document.getElementById('native-a')?.querySelector('.ci-native-popup-action')).toBeNull();
  dispose(); expect(document.querySelector('.ci-native-popup-action')).toBeNull();
});
test('rechecks thread identity at click rather than opening a stale thread', () => {
  markup(); let thread: string | null = 'thread-a'; const inspect = vi.fn();
  cleanup.push(mountNativeContextDetails({ document, resolveThread: () => thread, onInspect: inspect }));
  thread = null; (document.querySelector('.ci-native-popup-action') as HTMLButtonElement).click();
  expect(inspect).not.toHaveBeenCalled();
});
test('does not respond to unrelated dialogs or forged context labels', () => {
  markup(); document.querySelector('#pane-a button')?.setAttribute('aria-label', 'Context window something else');
  cleanup.push(mountNativeContextDetails({ document, resolveThread: () => 'thread-b', onInspect: vi.fn() }));
  expect(document.getElementById('native-a')?.querySelector('.ci-native-popup-action')).toBeNull();
});

test('does not attach when thread ownership cannot be resolved', () => {
  markup(); cleanup.push(mountNativeContextDetails({ document, resolveThread: () => null, onInspect: vi.fn() }));
  expect(document.querySelector('.ci-native-popup-action')).toBeNull();
});
