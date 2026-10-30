import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts.ts';
import { createOpener } from './src/open.ts';
import { parseRepository } from './src/repositories.ts';

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function target() {
    const { primaryHostId } = await bb.sdk.system.config();
    if (!primaryHostId) throw new Error('Connect this Mac to BB before cloning.');
    const info = await host.call('info', {}, { hostId: primaryHostId });
    if (info.platform !== 'darwin') throw new Error('Clone Repository supports the primary Mac only.');
    return { hostId: primaryHostId, ...info };
  }
  const openers = new Map<string, ReturnType<typeof createOpener>>();
  function opener(hostId: string) {
    let open = openers.get(hostId);
    if (!open) {
      open = createOpener({
        prepare: (repository, destination) => host.call('prepare', { repository, destination }, { hostId, timeoutMs: 610_000 }),
        listProjects: () => bb.sdk.projects.list(),
        createProject: (path, name) => bb.sdk.projects.create({ name, source: { type: 'local_path', hostId, path } }),
      }, hostId);
      openers.set(hostId, open);
    }
    return open;
  }
  bb.rpc.register(rpcContract, {
    init: async () => {
      const { hostId, defaultRoot } = await target();
      const projects = await bb.sdk.projects.list();
      const existing = projects.flatMap(project => {
        const repository = project.gitRemoteUrl ? parseRepository(project.gitRemoteUrl) : null;
        const source = project.sources.find(source => source.hostId === hostId);
        return repository && source ? [{ repository, projectId: project.id, path: source.path }] : [];
      });
      return { defaultRoot, existing };
    },
    list: async ({ page }) => {
      const { hostId } = await target();
      return host.call('list', { page }, { hostId, timeoutMs: 35_000 });
    },
    open: async ({ repository: input, destination }) => {
      const repository = parseRepository(input);
      if (!repository) return { ok: false as const, stage: 'clone' as const, message: 'Enter a GitHub owner/repo or repository URL.' };
      const { hostId } = await target();
      return opener(hostId)(repository, destination);
    },
  });
  bb.cli.register({
    name: 'clone-repository',
    summary: 'Inspect the Clone Repository plugin without cloning',
    commands: [{ name: 'status', summary: 'Check the Mac host and project discovery', usage: 'bb clone-repository status' }],
    async run(argv) {
      if (argv.length !== 1 || argv[0] !== 'status') return { exitCode: 1, stderr: 'Usage: bb clone-repository status' };
      try {
        const { hostId } = await target();
        const result = await host.call('list', { page: 1 }, { hostId, timeoutMs: 35_000 });
        return result.ok
          ? { exitCode: 0, stdout: `Mac host ready. GitHub discovery returned ${result.repositories.length} repositories on the first page.` }
          : { exitCode: 1, stderr: result.message };
      } catch (cause) {
        return { exitCode: 1, stderr: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  });
}
