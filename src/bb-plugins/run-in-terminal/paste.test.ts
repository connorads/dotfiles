import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { makePaste } from './paste.ts';

type Terminals = BbPluginApi['sdk']['terminals'];
type Session = Awaited<ReturnType<Terminals['create']>>;
const session = (id: string, title = 'Commands', status: Session['status'] = 'running'): Session => ({
  id, status, threadId: 'thread', environmentId: 'env', hostId: 'host',
  title, initialCwd: '/checkout', cols: 120, rows: 30,
  exitCode: null, closeReason: null, createdAt: 0, updatedAt: 0, lastUserInputAt: null,
});
const output = (chunks: number) => ({
  chunks: Array.from({ length: chunks }, (_, seq) => ({ dataBase64: '', seq })),
  closeReason: null, exitCode: null, nextSeq: chunks, status: 'running' as const, truncated: false,
});
const decode = (b64: string) => Buffer.from(b64, 'base64').toString();

test('pastes into the running Commands terminal as a bracketed paste with no Enter', async () => {
  const sent: string[] = [];
  const paste = makePaste({
    list: async () => ({ sessions: [session('other', 'Lazygit'), session('cmds')] }),
    create: async () => { throw new Error('must reuse'); },
    input: async ({ terminalId, dataBase64 }) => { sent.push(`${terminalId}:${decode(dataBase64)}`); return session(terminalId); },
    output: async () => output(1),
  });
  assert.equal(await paste('thread', 'ls\npwd'), 'cmds');
  assert.deepEqual(sent, ['cmds:\x1b[200~ls\npwd\x1b[201~']);
});

test('starts a shell in the thread and waits for its prompt before pasting', async () => {
  const events: string[] = [];
  let polls = 0;
  const paste = makePaste({
    list: async () => ({ sessions: [session('old', 'Commands', 'exited')] }),
    create: async (args) => {
      assert.deepEqual(args.scope, { kind: 'thread', threadId: 'thread' });
      assert.equal(args.start, undefined);
      events.push('create');
      return session('new');
    },
    output: async () => { events.push('poll'); return output(++polls >= 3 ? 1 : 0); },
    input: async () => { events.push('input'); return session('new'); },
  }, { pollMs: 1 });
  assert.equal(await paste('thread', 'ls'), 'new');
  assert.deepEqual(events, ['create', 'poll', 'poll', 'poll', 'input']);
});
