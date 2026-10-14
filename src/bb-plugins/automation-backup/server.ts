import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { cliCommand, defineCli, type BbPluginApi } from '@get-bb/plugin-sdk';
import { backup, command, makeSnapshot } from './backup.ts';

const projectList = z.array(z.object({ id: z.string(), name: z.string() }));
const records = z.array(z.object({ id: z.string(), execution: z.object({ mode: z.enum(['agent', 'script']) }).catchall(z.json()) }).passthrough());

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    directory: { type: 'string', label: 'Private backup checkout', default: '' },
    repository: { type: 'string', label: 'Private GitHub repository (owner/name)', default: '' },
  });
  let running: ReturnType<typeof backup> | undefined;
  let lastResult: Awaited<ReturnType<typeof backup>> | undefined;
  let lastError: string | undefined;
  let disposed = false;
  async function perform() {
    const config = await settings.get();
    if (!isAbsolute(config.directory) || !/^[\w.-]+\/[\w.-]+$/.test(config.repository)) throw new Error('Configure an absolute directory and private GitHub repository');
    const cli = process.env.BB_CLI || 'bb';
    return backup(config.directory, {
      async verifyRemote(origin) {
        const remote = z.object({ isPrivate: z.literal(true), url: z.string().url() }).parse(JSON.parse(await command('gh', ['repo', 'view', config.repository, '--json', 'isPrivate,url'])));
        const allowed = [remote.url, `${remote.url}.git`, `git@github.com:${config.repository}.git`];
        if (!allowed.includes(origin)) throw new Error('origin does not match the configured private repository');
      },
      async read() {
        const projects = projectList.parse(JSON.parse(await command(cli, ['project', 'list', '--include-personal', '--json'])));
        const collected = [];
        for (const project of projects) {
          const tasks = records.parse(JSON.parse(await command(cli, ['automation', 'list', '--project', project.id, '--json'])));
          const automations = [];
          for (const task of tasks) {
            if (task.execution.mode === 'script') {
              const path = z.string().parse(task.execution.storedScriptPath);
              const { storedScriptPath: _path, ...execution } = task.execution;
              automations.push({ ...task, execution: { ...execution, script: await readFile(path, 'utf8') } });
            } else automations.push(task);
          }
          collected.push({ ...project, automations });
        }
        return makeSnapshot(collected);
      },
    });
  }
  function run() {
    if (disposed) return Promise.reject(new Error('Backup plugin is stopping'));
    if (running) return running;
    running = perform().then(result => {
      lastResult = result;
      lastError = undefined;
      if (result.changed) bb.log.info(`Backed up ${result.automations} automations and pushed ${result.commit}`);
      return result;
    }, error => {
      lastError = error instanceof Error ? error.message : String(error);
      bb.log.error(lastError);
      throw error;
    }).finally(() => { running = undefined; });
    return running;
  }
  bb.cli.register(defineCli({
    name: 'automation-backup', summary: 'Back up automation definitions to private Git',
    commands: {
      run: cliCommand({ summary: 'Export, commit and push now', async run() { return { exitCode: 0, stdout: JSON.stringify(await run()) }; } }),
      status: cliCommand({ summary: 'Show the latest backup outcome', run() { return { exitCode: 0, stdout: JSON.stringify({ running: running !== undefined, lastResult, lastError }) }; } }),
    },
  }));
  bb.background.service('backup', {
    async start(signal) {
      while (!signal.aborted) {
        const config = await settings.get();
        if (config.directory && config.repository) await run().catch(() => {});
        try { await sleep(300_000, undefined, { signal }); }
        catch (error) { if (!signal.aborted) throw error; }
      }
    },
  });
  bb.onDispose(async () => { disposed = true; await running?.catch(() => {}); });
}
