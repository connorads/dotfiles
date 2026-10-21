import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: string; props: Record<string, unknown> & { children?: unknown } };
const source = ts.transpileModule(readFileSync(new URL('../commit-composer.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (cause: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const slots: unknown[] = [], effects: { dependencies: unknown[]; cleanup?: () => void }[] = [];
  const storage = new Map<string, string>([['git-glance:commit:repo', 'Existing draft']]);
  const calls: { method: string; input: unknown }[] = [];
  let cursor = 0, effectCursor = 0, requests = 0, commits = 0;
  let response = deferred();
  class Textarea {}
  const exported: { CommitComposer?: (props: unknown) => Element } = {};
  const jsx = (type: string, props: Element['props']): Element => ({ type, props });
  runInNewContext(source, {
    exports: exported, HTMLTextAreaElement: Textarea, crypto: { randomUUID: () => `request-${++requests}` },
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState: (initial: unknown) => {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef: (initial: unknown) => {
          const index = cursor++;
          if (!(index in slots)) slots[index] = { current: initial };
          return slots[index];
        },
        useEffect: (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
          const index = effectCursor++;
          const previous = effects[index];
          if (previous && previous.dependencies.every((value, i) => value === dependencies[i])) return;
          previous?.cleanup?.();
          effects[index] = { dependencies, cleanup: effect() };
        },
      };
      if (name === '@get-bb/plugin-sdk/app') return { useRpc: () => ({ call: (method: string, input: unknown) => {
        calls.push({ method, input });
        if (method === 'generateMessage') return response.promise;
        return Promise.resolve(method === 'review' ? { head: 'head', index: 'index', count: 1, blocked: null, draftKey: 'repo' } : {});
      } }) };
      if (name === './src/format.ts') return { plural: () => '1 staged file' };
      if (name === './ui.tsx') return { message: (cause: Error) => cause.message };
      throw new Error(`Unexpected import ${name}`);
    },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  });
  function render(repository = 'repo') {
    cursor = 0; effectCursor = 0;
    return exported.CommitComposer!({ threadId: 'thread', repository, branch: 'main', op: null,
      onRun: async () => { commits++; return true; }, onCancel: () => {} });
  }
  function find(element: Element, predicate: (element: Element) => boolean): Element {
    if (predicate(element)) return element;
    const children = [element.props.children].flat().filter((child): child is Element => !!child && typeof child === 'object');
    for (const child of children) { try { return find(child, predicate); } catch {} }
    throw new Error('Element not found');
  }
  const button = (label: string) => find(render(), element => element.type === 'button' && element.props.children === label);
  const click = (label: string) => (button(label).props.onClick as () => void)();
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { render, find, button, click, flush, calls, storage,
    get commits() { return commits; },
    get response() { return response; },
    retry: () => { response = deferred(); },
    unmount: () => { for (const effect of effects) effect.cleanup?.(); },
    edit: (value: string) => (find(render(), element => element.type === 'textarea').props.onChange as (event: unknown) => void)({ target: { value } }),
  };
}
async function opened() {
  const h = harness(); h.click('Commit staged changes'); await h.flush(); return h;
}

test('explicit generation blocks duplicate clicks and commits until completion, then saves editable text', async () => {
  const h = await opened();
  assert.equal(h.calls.filter(call => call.method === 'generateMessage').length, 0);
  const click = h.button('Generate message').props.onClick as () => void;
  click(); click();
  assert.equal(h.calls.filter(call => call.method === 'generateMessage').length, 1);
  assert.equal(h.button('Commit complete staged index').props.disabled, true);
  h.response.resolve({ message: 'Generated subject' }); await h.flush();
  assert.equal(h.storage.get('git-glance:commit:repo'), 'Generated subject');
  assert.equal(h.commits, 0);
  h.edit('Edited subject');
  assert.equal(h.storage.get('git-glance:commit:repo'), 'Edited subject');
});

test('generation failure preserves the draft and permits retry', async () => {
  const h = await opened(); h.click('Generate message');
  h.response.reject(new Error('Model unavailable')); await h.flush();
  assert.equal(h.storage.get('git-glance:commit:repo'), 'Existing draft');
  assert.equal(h.find(h.render(), element => element.props.role === 'alert').props.children, 'Model unavailable');
  h.retry(); h.click('Generate message');
  h.response.resolve({ message: 'Retry subject' }); await h.flush();
  assert.equal(h.storage.get('git-glance:commit:repo'), 'Retry subject');
});

test('edits, close, cancellation, repository changes and unmount invalidate late responses', async () => {
  for (const action of ['edit', 'close', 'cancel', 'repo', 'unmount']) {
    const h = await opened(); h.click('Generate message');
    if (action === 'edit') h.edit('New edit');
    if (action === 'close') h.click('Close and keep draft');
    if (action === 'cancel') h.click('Cancel generation');
    if (action === 'repo') h.render('another-repo');
    if (action === 'unmount') h.unmount();
    h.response.resolve({ message: 'Late subject' }); await h.flush();
    assert.equal(h.storage.get('git-glance:commit:repo'), action === 'edit' ? 'New edit' : 'Existing draft', action);
    assert.ok(h.calls.some(call => call.method === 'cancelMessage'), action);
    assert.equal(h.commits, 0);
  }
});

test('another window editing the stored draft prevents overwrite', async () => {
  const h = await opened(); h.click('Generate message');
  h.storage.set('git-glance:commit:repo', 'Other window edit');
  h.response.resolve({ message: 'Late subject' }); await h.flush();
  assert.equal(h.storage.get('git-glance:commit:repo'), 'Other window edit');
});


test('Enter on Generate message leaves button activation to the browser and never commits the existing draft', async () => {
  const h = await opened();
  const keydown = h.find(h.render(), element => element.type === 'form').props.onKeyDown as (event: unknown) => void;
  let prevented = false;
  keydown({ key: 'Enter', target: h.button('Generate message'), shiftKey: false, repeat: false,
    nativeEvent: { isComposing: false }, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(h.commits, 0);
  assert.equal(prevented, false);
  h.click('Generate message');
  h.response.resolve({ message: 'Generated via keyboard' }); await h.flush();
  assert.equal(h.storage.get('git-glance:commit:repo'), 'Generated via keyboard');
  assert.equal(h.commits, 0);
});
