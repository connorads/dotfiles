import { randomUUID } from 'node:crypto';
import type { BbPluginApi, PluginCliResult } from '@get-bb/plugin-sdk';
import { legacyListSchema, modelsContract } from './contract.ts';
import { createStore } from './store.ts';

const legacyPluginId = 'model-favourites';

export function registerModels(bb: BbPluginApi) {
  const store = createStore({
    get: () => bb.storage.kv.get('favourites'),
    set: value => bb.storage.kv.set('favourites', value),
  }, randomUUID, () => bb.realtime.publish('favourites-changed', {}));
  bb.rpc.register(modelsContract, {
    'favourites.list': () => store.list(),
    'favourites.add': input => store.add(input),
    'favourites.remove': input => store.remove(input.id),
    'favourites.rename': input => store.rename(input.id, input.name),
    'favourites.move': input => store.move(input.id, input.direction),
    'favourites.setEffort': input => store.setEffort(input.id, input.reasoningLevel),
  });
  async function migrateFavourites(): Promise<PluginCliResult> {
    const { plugins } = await bb.sdk.plugins.list();
    if (!plugins.some(item => item.id === legacyPluginId && item.enabled)) {
      return { exitCode: 1, stderr: 'Enable Model Favourites to migrate. Nothing changed.\n' };
    }
    let legacy;
    try {
      legacy = legacyListSchema.parse(await bb.sdk.plugins.callRpc({
        pluginId: legacyPluginId, method: 'list', input: {}, outputSchema: legacyListSchema }));
    } catch (error) {
      return { exitCode: 1, stderr: `Could not read Model Favourites: ${error instanceof Error ? error.message : String(error)}. Nothing changed.\n` };
    }
    return { exitCode: 0, stdout: JSON.stringify(await store.importLegacy(legacy), null, 2) + '\n' };
  }
  return { migrateFavourites };
}
