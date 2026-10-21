import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('RPC rejection retains the draft and permits another commit submission', async () => {
  const storage = new Map<string, string>();
  const slots: unknown[] = [];
  let cursor = 0;
  let attempts = 0;
  const source = ts.transpileModule(readFileSync(new URL('../commit-composer.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  type Element = { type: string; props: Record<string, unknown> & { children?: Element | Element[] } };
  const jsx = (type: string, props: Element['props']): Element => ({ type, props });
  const exports: { CommitComposer?: (props: unknown) => Element } = {};
  runInNewContext(source, {
    exports,
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
        useEffect: () => {},
      };
      if (name === '@get-bb/plugin-sdk/app') return { useRpc: () => ({ call: async () => ({ head: 'head', index: 'index', count: 1, blocked: null, draftKey: 'repo' }) }) };
      if (name === './src/format.ts') return { plural: () => '1 staged file' };
      if (name === './ui.tsx') return { message: String };
      throw new Error(`Unexpected import ${name}`);
    },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  });
  const render = () => {
    cursor = 0;
    return exports.CommitComposer!({ threadId: 'thread', repository: 'repo', branch: 'main', op: null,
      onRun: async () => { attempts++; return attempts > 1; }, onCancel: () => {} });
  };
  function find(element: Element, predicate: (element: Element) => boolean): Element {
    if (predicate(element)) return element;
    const children = [element.props.children].flat().filter((child): child is Element => !!child && typeof child === 'object');
    for (const child of children) {
      try { return find(child, predicate); } catch { /* Search remaining siblings. */ }
    }
    throw new Error('Element not found');
  }
  const click = (element: Element) => (element.props.onClick as () => void)();
  click(find(render(), element => element.type === 'button'));
  await Promise.resolve();
  const textarea = find(render(), element => element.type === 'textarea');
  (textarea.props.onChange as (event: unknown) => void)({ target: { value: 'Keep this draft' } });
  const submit = () => (find(render(), element => element.type === 'form').props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  submit();
  await Promise.resolve();
  assert.equal(storage.get('git-glance:commit:repo'), 'Keep this draft');
  assert.equal(storage.has('git-glance:commit:repo:pending'), false);
  assert.equal(find(render(), element => element.props.type === 'submit').props.disabled, false);
  submit();
  await Promise.resolve();
  assert.equal(attempts, 2);
  assert.ok(storage.has('git-glance:commit:repo:pending'));
});
