import { readFile, watch } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { mergePreferences, parsePreferences } from './preferences.ts';

export default function plugin(bb: BbPluginApi) {
  const path = join(homedir(), 'src/bb-plugins/bb-plugin-preferences-spike/preferences.json');
  let queue = Promise.resolve();
  function apply() {
    const next = queue.then(async () => {
      const desired = parsePreferences(JSON.parse(await readFile(path, 'utf8'))).keyboard;
      const current = (await bb.sdk.system.config()).keybindingOverrides;
      const merged = mergePreferences(current, desired);
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        await bb.sdk.system.updateKeyboardSettings(merged);
      }
      return `Applied ${desired.length} file-managed shortcuts from ${path}`;
    });
    queue = next.then(() => undefined, () => undefined);
    return next;
  }
  bb.cli.register({
    name: 'preferences-spike',
    summary: 'Apply file-managed keyboard shortcuts',
    commands: [{ name: 'apply', summary: 'Apply preferences file', usage: 'bb preferences-spike apply' }],
    async run(argv) {
      if (argv.length !== 1 || argv[0] !== 'apply') return { exitCode: 1, stdout: 'Usage: bb preferences-spike apply' };
      return { exitCode: 0, stdout: await apply() };
    },
  });
  bb.background.service('preferences-file', {
    async start(signal) {
      const watcher = watch(dirname(path), { signal });
      const sync = async () => {
        try { bb.log.info(await apply()); }
        catch (error) { bb.log.error(`Preferences unchanged: ${String(error)}`); }
      };
      try {
        await sync();
        for await (const event of watcher) {
          if (event.filename === basename(path)) await sync();
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    },
  });
}
