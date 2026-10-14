import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { rpcContract } from './contracts.ts';
import { makePaste } from './paste.ts';

export default function plugin(bb: BbPluginApi) {
  const paste = makePaste(bb.sdk.terminals);
  bb.rpc.register(rpcContract, {
    paste: async ({ threadId, text }) => ({ terminalId: await paste(threadId, text) }),
  });
}
