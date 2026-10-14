import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { rpcContract } from './contracts.ts';
import { makeOpenLazygit } from './open.ts';

export default function plugin(bb: BbPluginApi) {
  const open = makeOpenLazygit(bb.sdk.terminals, bb.sdk.projects);
  bb.rpc.register(rpcContract, {
    open: async target => ({ terminalId: await open(target) }),
  });
  bb.cli.register({
    name: 'lazygit',
    summary: 'Open or reuse lazygit in a thread checkout',
    commands: [{ name: 'open', summary: 'Start lazygit', usage: 'bb lazygit open <thread-id>' }],
    async run(argv) {
      if (argv.length !== 2 || argv[0] !== 'open' || !argv[1]) {
        return { exitCode: argv.includes('--help') ? 0 : 1, stdout: 'Usage: bb lazygit open <thread-id>' };
      }
      return { exitCode: 0, stdout: JSON.stringify({ terminalId: await open({ kind: 'thread', threadId: argv[1] }) }) };
    },
  });
}
