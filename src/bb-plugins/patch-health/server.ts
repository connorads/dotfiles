import { cliCommand, defineCli, type BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts';
import { unavailable } from './model';
export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function labCall(method: 'labStatus' | 'prepareLab' | 'runLab' | 'reconcileLab', input: Record<string, never> | { id: string; revision: number }) {
    try {
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) return { kind: 'unavailable' as const, reason: 'The server host could not be identified.' };
      return await host.call(method, input, { hostId, timeoutMs: 25_000 });
    } catch { return { kind: 'unavailable' as const, reason: 'Rehearsal host unavailable. Reconnect to inspect the saved operation.' }; }
  }
  bb.cli.register(defineCli({ name: 'patches', summary: 'Inspect and rehearse BB patches without live activation', commands: {
    status: cliCommand({ summary: 'Read the saved disposable rehearsal', async run() { return { exitCode: 0, stdout: JSON.stringify(await labCall('labStatus', {})) }; } }),
    prepare: cliCommand({ summary: 'Prepare an isolated, verified candidate without changing live BB', async run() { return { exitCode: 0, stdout: JSON.stringify(await labCall('prepareLab', {})) }; } }),
    rehearse: cliCommand({ summary: 'Restart only the prepared disposable server', options: {
      id: { type: 'string', required: true, description: 'Reviewed rehearsal operation ID' },
      revision: { type: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER, required: true, description: 'Reviewed operation revision' },
    }, async run(input) { return { exitCode: 0, stdout: JSON.stringify(await labCall('runLab', { id: input.options.id, revision: input.options.revision })) }; } }),
  } }));
  bb.rpc.register(rpcContract, {
    labStatus: () => labCall('labStatus', {}),
    prepareLab: () => labCall('prepareLab', {}),
    runLab: input => labCall('runLab', input),
    reconcileLab: input => labCall('reconcileLab', input),
    async inspect() {
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) return { hostId: null, snapshot: unavailable('The server host could not be identified.', new Date().toISOString()) };
      try { return { hostId, snapshot: await host.call('inspect', {}, { hostId, timeoutMs: 15_000 }) }; }
      catch { return { hostId, snapshot: unavailable('The server host could not be reached. Refresh to collect a new observation.', new Date().toISOString()) }; }
    },
  });
}
