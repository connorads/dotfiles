import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandsFrom } from './commands.ts';

const message = [
  'Run this:', '```bash', 'cd ~/git/ch-mirror', 'pnpm install', '```',
  'Config:', '```json', '{"a":1}', '```',
  'Then:', '```sh', '$ pnpm exec alchemy destroy --dry-run', '```',
].join('\n');

test('a selection wins over the message fences', () => {
  assert.equal(commandsFrom('pnpm install\n', message), 'pnpm install');
});

test('without a selection, joins every shell fence and skips other languages', () => {
  assert.equal(commandsFrom(undefined, message), 'cd ~/git/ch-mirror\npnpm install\npnpm exec alchemy destroy --dry-run');
});

test('strips copied prompts from a selection', () => {
  assert.equal(commandsFrom('$ ls\n  $ pwd', ''), 'ls\npwd');
});

test('a message with no shell fence yields nothing to paste', () => {
  assert.equal(commandsFrom('  ', 'just prose'), '');
});
