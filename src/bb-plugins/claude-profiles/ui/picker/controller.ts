import type { PluginBrowserBbSdk, PluginComposerApi, PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import type { Favourite } from '../../src/models/contract.ts';
import { availability, matches, nextFavourite, planSelection } from '../../src/models/favourites.ts';

export function createController(composer: PluginComposerApi, sdk: PluginBrowserBbSdk, rpc: PluginRpcClient<typeof rpcContract>) {
  let busy = false;
  async function scope() {
    if (composer.scope.kind === 'queued-message') throw new Error('Use the main chat input to switch favourites.');
    if (composer.scope.kind === 'thread') {
      const thread = await sdk.threads.get({ threadId: composer.scope.threadId });
      if (!thread.environmentId) throw new Error('This chat has no environment.');
      return { environmentId: thread.environmentId };
    }
    const environment = composer.selection?.environment;
    if (environment?.type === 'reuse') return { environmentId: environment.environmentId };
    if (environment?.type === 'host' && environment.hostId) return { hostId: environment.hostId };
    if (environment?.type === 'provider' && environment.machine?.type === 'existing') return { hostId: environment.machine.hostId };
    throw new Error('Choose a machine before switching favourites.');
  }
  async function statuses(list: Favourite[]) {
    const target = await scope();
    const providers = [...new Set(list.map(f => f.providerId))];
    const catalogs = await Promise.all(providers.map(async providerId => {
      try {
        const options = await sdk.system.executionOptions({ ...target, providerId });
        return { providerId, available: options.providers.some(p => p.id === providerId && p.available),
          error: options.modelLoadError?.detail ?? (options.modelLoadError ? 'Could not load this provider’s models' : null),
          models: options.models,
        };
      } catch (error) {
        return { providerId, available: false, error: error instanceof Error ? error.message : 'Could not load models', models: [] };
      }
    }));
    return new Map(list.map(favourite => {
      const catalog = catalogs.find(c => c.providerId === favourite.providerId);
      return [favourite.id, catalog ? availability(favourite, catalog) : 'Could not load models'];
    }));
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('A favourite is already being applied.');
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function applyChecked(favourite: Favourite) {
    if (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread') throw new Error('Use the main chat input to switch models.');
    const options = await sdk.system.executionOptions({ ...await scope(), providerId: favourite.providerId });
    const reason = availability(favourite, {
      available: options.providers.some(p => p.id === favourite.providerId && p.available),
      error: options.modelLoadError?.detail ?? null, models: options.models,
    });
    if (reason) throw new Error(reason);
    const model = options.models.find(m => m.model === favourite.model);
    if (!model) throw new Error('Model unavailable on this machine.');
    const plan = planSelection(favourite, model);
    const tiers = model.supportedServiceTiers ?? [];
    const currentTier = composer.selection?.serviceTier;
    const supportsTier = options.providers.find(p => p.id === favourite.providerId)?.capabilities.supportsServiceTier;
    const serviceTier = supportsTier ? (currentTier && tiers.some(t => t.id === currentTier) ? currentTier : 'default') : undefined;
    const requested = { ...plan, ...(serviceTier ? { serviceTier } : {}) };
    const settled = await composer.setSelection(requested);
    if (!settled || !matches(requested, settled) || settled.reasoningLevel !== plan.reasoningLevel || (serviceTier !== undefined && settled.serviceTier !== serviceTier)) {
      throw new Error('BB could not apply this selection. Check the current model before sending.');
    }
  }
  return {
    statuses,
    async models(providerId: string) {
      return (await sdk.system.executionOptions({ ...await scope(), providerId })).models;
    },
    async catalog() {
      const target = await scope();
      const initial = await sdk.system.executionOptions({ ...target, providerId: composer.selection?.providerId });
      return Promise.all(initial.providers.filter(provider => provider.available).map(async provider => {
        try {
          const options = provider.id === composer.selection?.providerId ? initial : await sdk.system.executionOptions({ ...target, providerId: provider.id });
          return { providerId: provider.id, providerName: provider.displayName, models: options.models,
            error: options.modelLoadError?.detail ?? null };
        } catch (cause) {
          return { providerId: provider.id, providerName: provider.displayName, models: [],
            error: cause instanceof Error ? cause.message : 'Could not load models' };
        }
      }));
    },
    apply(favourite: Favourite) {
      return exclusive(() => applyChecked(favourite));
    },
    select(slot: number) {
      return exclusive(async () => {
        const favourite = (await rpc.call('favourites.list', {})).find(f => f.slot === slot);
        if (!favourite) throw new Error(`Favourite ${slot} is empty. Save a selection in the favourites menu.`);
        await applyChecked(favourite);
        composer.focus();
      });
    },
    cycle(direction: -1 | 1) {
      return exclusive(async () => {
        const list = await rpc.call('favourites.list', {});
        if (!list.length) throw new Error('Save a model favourite before cycling.');
        const reasons = await statuses(list);
        const next = nextFavourite(list, composer.selection, direction, favourite => reasons.get(favourite.id) ?? null);
        if (!next) throw new Error('No favourites are available on this machine. Open the favourites menu for details.');
        await applyChecked(next);
        composer.focus();
      });
    },
  };
}
export type Controller = ReturnType<typeof createController>;
