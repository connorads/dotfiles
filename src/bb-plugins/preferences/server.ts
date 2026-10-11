import { readFile, watch } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { mergePreferences, parsePreferences } from './preferences.ts';

export default function plugin(bb: BbPluginApi) {
  const path = join(homedir(), '.config/bb/preferences.json');
  const ownershipKey = 'managed-keyboard';
  let queue = Promise.resolve();
  let disposed = false;
  function apply() {
    const next = queue.then(async () => {
      if (disposed) throw new Error('Preferences plugin is stopped');
      const desired = parsePreferences(JSON.parse(await readFile(path, 'utf8'))).keyboard;
      const stored = await bb.storage.kv.get(ownershipKey);
      const previous = stored === null || stored === undefined ? [] : parsePreferences(stored).keyboard;
      const current = (await bb.sdk.system.config()).keybindingOverrides;
      const merged = mergePreferences(current, desired, previous);
      if (disposed) throw new Error('Preferences plugin is stopped');
      if (JSON.stringify(previous) !== JSON.stringify(desired)) {
        // Record ownership before changing settings so interrupted applies can remove stale overrides.
        await bb.storage.kv.set(ownershipKey, { keyboard: mergePreferences(previous, desired, []) });
      }
      if (merged !== current) {
        await bb.sdk.system.updateKeyboardSettings(merged);
        bb.log.info(`Applied ${desired.length} file-managed shortcuts from ${path}`);
      }
      if (JSON.stringify(previous) !== JSON.stringify(desired)) {
        await bb.storage.kv.set(ownershipKey, { keyboard: desired });
      }
      return `Applied ${desired.length} file-managed shortcuts from ${path}`;
    });
    queue = next.then(() => undefined, () => undefined);
    return next;
  }
  bb.cli.register({
    name: 'preferences',
    summary: 'Apply file-managed keyboard shortcuts',
    commands: [{ name: 'apply', summary: 'Apply preferences file', usage: 'bb preferences apply' }],
    async run(argv) {
      if (argv.length === 1 && argv[0] === '--help') return { exitCode: 0, stdout: 'Usage: bb preferences apply' };
      if (argv.length !== 1 || argv[0] !== 'apply') return { exitCode: 1, stdout: 'Usage: bb preferences apply' };
      try { return { exitCode: 0, stdout: await apply() }; }
      catch (error) { return { exitCode: 1, stderr: `Preferences unchanged: ${String(error)}` }; }
    },
  });
  bb.background.service('preferences-file', {
    async start(signal) {
      const watcher = watch(dirname(path), { signal })[Symbol.asyncIterator]();
      const sync = async () => {
        if (signal.aborted) return;
        try { await apply(); }
        catch (error) { if (!signal.aborted) bb.log.error(`Preferences unchanged: ${String(error)}`); }
      };
      const subscriptions: (() => void)[] = [];
      try {
        subscriptions.push(bb.sdk.subscribe({ event: 'system:config-changed', callback: () => { void sync(); } }));
        subscriptions.push(bb.sdk.subscribe({ event: 'realtime:connection', callback: event => {
          if (event.state === 'connected') void sync();
        } }));
        await sync();
        while (!signal.aborted) {
          const event = await watcher.next();
          if (event.done) break;
          if (event.value.filename === null || event.value.filename === basename(path)) await sync();
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      } finally {
        for (const unsubscribe of subscriptions.reverse()) unsubscribe();
        await watcher.return?.();
        await queue;
      }
    },
  });
  bb.onDispose(async () => { disposed = true; await queue; });
}
