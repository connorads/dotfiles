import { randomUUID } from 'node:crypto';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { rpcContract } from './contracts.ts';
import { createStore } from './store.ts';

export default function plugin(bb: BbPluginApi) {
  const store = createStore({
    get: () => bb.storage.kv.get('favourites'),
    set: value => bb.storage.kv.set('favourites', value),
  }, randomUUID, () => bb.realtime.publish('changed', {}));
  bb.rpc.register(rpcContract, {
    list: () => store.list(),
    add: input => store.add(input),
    rename: input => store.rename(input.id, input.name),
    remove: input => store.remove(input.id),
    move: input => store.move(input.id, input.direction),
  });
}
