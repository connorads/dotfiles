import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { commandSchema } from './contracts.ts';
import { rpcContract } from './rpc.ts';
import { makeBroker } from './broker.ts';
import { makeArchives } from './archive.ts';

export default function plugin(bb: BbPluginApi) {
  const archives = makeArchives({
    get: id => bb.sdk.threads.get({ threadId: id }),
    children: async id => (await bb.sdk.threads.childSummary({ threadId: id })).unarchivedDescendantCount,
    archive: async id => (await bb.sdk.threads.archiveAll({ threadId: id })).archivedThreadIds,
    unarchive: async id => { await bb.sdk.threads.unarchive({ threadId: id }); },
    load: () => bb.storage.kv.get('voice-archives'),
    save: value => bb.storage.kv.set('voice-archives', value),
  });
  const broker = makeBroker(request => bb.realtime.publish('command', request));
  bb.onDispose(() => broker.dispose());
  bb.rpc.register(rpcContract, {
    archiveTarget: ({ threadId }) => archives.inspect(threadId),
    archive: ({ target, confirmed }) => archives.archive(target, confirmed),
    restore: () => archives.restore(),
    claim: ({ requestId }) => ({ claimed: broker.claim(requestId) }),
    complete: ({ requestId, reply }) => ({ accepted: broker.complete(requestId, reply) }),
  });
  bb.http.route('POST', '/command', async context => {
    const parsed = commandSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ ok: false, message: 'Invalid voice command.' }, 400);
    return context.json(await broker.dispatch(parsed.data));
  });
  bb.cli.register({
    name: 'handsfree',
    summary: 'Control the focused BB window',
    commands: [{ name: 'command', summary: 'Run a JSON voice command', usage: 'bb handsfree command <json>' }],
    async run(argv) {
      if (argv.length !== 2 || argv[0] !== 'command') {
        return { exitCode: argv.includes('--help') ? 0 : 1, stdout: 'Usage: bb handsfree command <json>' };
      }
      let value: unknown;
      try { value = JSON.parse(argv[1]); }
      catch { return { exitCode: 1, stderr: 'Command must be JSON.' }; }
      const parsed = commandSchema.safeParse(value);
      if (!parsed.success) return { exitCode: 1, stderr: 'Invalid voice command.' };
      const reply = await broker.dispatch(parsed.data);
      return { exitCode: reply.ok ? 0 : 1, stdout: JSON.stringify(reply) };
    },
  });
}
