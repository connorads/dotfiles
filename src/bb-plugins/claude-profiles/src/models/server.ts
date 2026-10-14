import { randomUUID } from 'node:crypto';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { modelsContract } from './contract.ts';
import { createStore } from './store.ts';

export function registerModels(bb: BbPluginApi) {
  const store = createStore({
    get: () => bb.storage.kv.get('favourites'),
    set: value => bb.storage.kv.set('favourites', value),
  }, randomUUID, () => bb.realtime.publish('favourites-changed', {}));
  bb.rpc.register(modelsContract, {
    'favourites.list': () => store.list(),
    'favourites.add': input => store.add(input),
    'favourites.remove': input => store.remove(input.id),
    'favourites.setEffort': input => store.setEffort(input.id, input.reasoningLevel),
  });
}
