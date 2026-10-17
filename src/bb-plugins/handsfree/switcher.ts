import type { PluginBrowserBbSdk, PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { z } from 'zod';
import { listSchema } from '../claude-profiles/src/models/contract.ts';
import { createController } from '../claude-profiles/ui/picker/controller.ts';

const accountsSchema = z.object({ supported: z.boolean(), currentId: z.string(),
  profiles: z.array(z.object({ id: z.string(), label: z.string() })) });
const chosenSchema = z.object({ currentId: z.string() });

// Agent Switcher owns account transfer and model validation for both input methods.
export function switcher(composer: PluginComposerApi, sdk: PluginBrowserBbSdk, assertCurrent: () => void) {
  const favourites = () => sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'favourites.list',
    input: {}, outputSchema: listSchema });
  const controller = createController(composer, sdk, { call: favourites }, assertCurrent);
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const checkAccountScope = () => {
    if (composer.selection?.providerId !== 'claude-code') throw new Error('Accounts are available for Claude Code. Select a Claude model first.');
    if (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread') throw new Error('Use the main chat input to switch accounts.');
  };
  return {
    controller,
    favourites,
    async models() {
      const catalog = await controller.catalog();
      const rows = catalog.flatMap(provider => provider.models
        .filter(model => !model.routeProviderId || model.routeProviderId === provider.providerId)
        .map(model => ({
          id: JSON.stringify([provider.providerId, model.model]),
          title: model.displayName,
          label: `${model.displayName} (${provider.providerName})`,
        })));
      if (!rows.length) throw new Error(catalog.find(provider => provider.error)?.error ?? 'No models are available on this machine.');
      return rows;
    },
    async applyModel(id: string) {
      const [providerId, model] = z.tuple([z.string().min(1), z.string().min(1)]).parse(JSON.parse(id));
      await controller.apply({ providerId, model });
    },
    async accounts() {
      checkAccountScope();
      const result = await sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'accounts',
        input: { threadId }, outputSchema: accountsSchema });
      if (!result.supported) throw new Error('Account selection is unavailable here. A provider handoff must send its first message before switching accounts.');
      return result;
    },
    async chooseAccount(profileId: string) {
      checkAccountScope();
      if (composer.isRunning) throw new Error('Stop or finish this turn before switching accounts.');
      assertCurrent();
      const result = await sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'choose',
        input: { threadId, profileId }, outputSchema: chosenSchema });
      if (result.currentId !== profileId) throw new Error('BB did not select that account. Check the account picker.');
    },
  };
}
