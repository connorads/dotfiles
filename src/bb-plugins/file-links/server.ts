import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts';

export default function plugin(bb:BbPluginApi) {
  const host = bb.hosts.experimental_client({contract:hostContract});
  bb.rpc.register(rpcContract,{
    exists: ({hostId,path})=>host.call('exists',{path},{hostId}),
  });
}
