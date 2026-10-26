import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTerminal, parseOsc52, tweak, type XTerm } from './xterm.ts';

const hooks = (...states: unknown[]) =>
  states.reduceRight<unknown>((next, memoizedState) => ({ memoizedState, next }), null);

function fakeTerminal() {
  const element = {};
  const osc = new Map<number, (data: string) => boolean>();
  const term = {
    element, options: { macOptionIsMeta: false, cursorBlink: true, vtExtensions: { win32InputMode: false } },
    parser: { registerOscHandler(id: number, fn: (data: string) => boolean) { osc.set(id, fn); return { dispose: () => osc.delete(id) }; } },
  };
  return { term: term as unknown as XTerm, osc };
}

test('findTerminal reads the terminal from a ref in an ancestor component', () => {
  const xterm = {} as HTMLElement;
  const term = { element: xterm };
  const component = { memoizedState: hooks(false, { current: null }, { current: term }), return: null };
  const hostFiber = { memoizedState: null, return: component };
  Object.assign(xterm, { parentElement: { '__reactFiber$abc': hostFiber } });
  assert.equal(findTerminal(xterm), term);
});

test('findTerminal ignores refs that hold another terminal', () => {
  const xterm = {} as HTMLElement;
  const component = { memoizedState: hooks({ current: { element: {} } }), return: null };
  Object.assign(xterm, { parentElement: { '__reactFiber$abc': { memoizedState: null, return: component } } });
  assert.equal(findTerminal(xterm), null);
});

test('findTerminal returns null outside React', () => {
  const xterm = { parentElement: {} } as unknown as HTMLElement;
  assert.equal(findTerminal(xterm), null);
});

test('parseOsc52 decodes UTF-8 clipboard writes', () => {
  assert.equal(parseOsc52('c;' + Buffer.from('héllo').toString('base64')), 'héllo');
  assert.equal(parseOsc52(';' + Buffer.from('x').toString('base64')), 'x');
});

test('parseOsc52 refuses clipboard reads and malformed data', () => {
  assert.equal(parseOsc52('c;?'), null);
  assert.equal(parseOsc52('nopayload'), null);
  assert.equal(parseOsc52('c;' + Buffer.from([0xff]).toString('base64')), null);
});

test('tweak sets Kitty-like options and restores the originals', () => {
  const { term } = fakeTerminal();
  const restore = tweak(term, () => {});
  assert.deepEqual(term.options, { macOptionIsMeta: true, cursorBlink: false, vtExtensions: { win32InputMode: false, kittyKeyboard: true } });
  restore();
  assert.deepEqual(term.options, { macOptionIsMeta: false, cursorBlink: true, vtExtensions: { win32InputMode: false } });
});

test('tweak copies OSC 52 writes until restored', () => {
  const { term, osc } = fakeTerminal();
  const copied: string[] = [];
  const restore = tweak(term, text => copied.push(text));
  osc.get(52)?.('c;' + Buffer.from('from nvim').toString('base64'));
  assert.deepEqual(copied, ['from nvim']);
  restore();
  assert.equal(osc.has(52), false);
});
