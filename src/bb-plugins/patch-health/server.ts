import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts';
import { unavailable } from './model';
export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    async inspect() {
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) return { hostId: null, snapshot: unavailable('The server host could not be identified.', new Date().toISOString()) };
      try { return { hostId, snapshot: await host.call('inspect', {}, { hostId, timeoutMs: 15_000 }) }; }
      catch { return { hostId, snapshot: unavailable('The server host could not be reached. Refresh to collect a new observation.', new Date().toISOString()) }; }
    },
  });
}
