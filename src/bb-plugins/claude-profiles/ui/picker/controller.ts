import type { PluginBrowserBbSdk, PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { effortSchema, type Favourite, type Setup } from '../../src/models/contract.ts';
import { selectionChanged } from './store.ts';
import { availability, matches, nextFavourite, planSelection } from '../../src/models/favourites.ts';

export function createController(composer: PluginComposerApi, sdk: PluginBrowserBbSdk, rpc: {
  call(method: 'favourites.list', input: Record<string, never>): Promise<Favourite[]>;
}, assertCurrent: () => void = () => {}) {
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
  async function executionOptions(providerId?: string) {
    const options = await sdk.system.executionOptions({ ...await scope(), providerId });
    return { ...options, models: options.models.map(model => ({ ...model,
      defaultReasoningEffort: effortSchema.parse(model.defaultReasoningEffort),
      supportedReasoningEfforts: model.supportedReasoningEfforts.map(effort => ({ ...effort, reasoningEffort: effortSchema.parse(effort.reasoningEffort) })),
    })) };
  }
  function scopeReason(favourite: Setup): string | null {
    if (favourite.daybreak !== undefined && composer.scope.kind !== 'thread') return 'Daybreak favourites are available after starting a thread';
    if (favourite.daybreak !== undefined && composer.selection?.providerId !== favourite.providerId) return 'Switch to Codex before choosing its Daybreak setting';
    return null;
  }
  async function daybreak(): Promise<boolean | undefined> {
    if (composer.scope.kind !== 'thread' || composer.selection?.providerId !== 'codex') return undefined;
    const timeline = await sdk.threads.timeline({ threadId: composer.scope.threadId, segmentLimit: '1', summaryOnly: 'true' });
    const option = timeline.sessionOptions?.find(option => option.id === 'daybreak');
    return option?.type === 'boolean' ? option.pendingValue ?? option.value : undefined;
  }
  async function statuses(list: Favourite[]) {
    const providers = [...new Set(list.map(f => f.providerId))];
    const catalogs = await Promise.all(providers.map(async providerId => {
      try {
        const options = await executionOptions(providerId);
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
      return [favourite.id, catalog ? scopeReason(favourite) ?? availability(favourite, catalog) : 'Could not load models'];
    }));
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('A favourite is already being applied.');
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function applyChecked(favourite: Setup) {
    if (composer.scope.kind !== 'thread' && composer.scope.kind !== 'new-thread') throw new Error('Use the main chat input to switch models.');
    const scopeError = scopeReason(favourite);
    if (scopeError) throw new Error(scopeError);
    const options = await executionOptions(favourite.providerId);
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
    assertCurrent();
    const programme = favourite.daybreak ?? (model.sessionOptions?.some(option => option.id === 'daybreak') ? false : undefined);
    if (programme !== undefined && composer.scope.kind === 'thread' && composer.selection?.providerId === favourite.providerId) {
      await sdk.threads.update({ threadId: composer.scope.threadId, model: plan.model,
        reasoningLevel: plan.reasoningLevel, sessionOptions: { daybreak: programme } });
      if (await daybreak() !== programme) throw new Error('BB could not apply the Daybreak setting. Check the native model picker.');
    }
    const settled = await composer.setSelection(requested);
    if (!settled || !matches(requested, settled) || settled.reasoningLevel !== plan.reasoningLevel || (serviceTier !== undefined && settled.serviceTier !== serviceTier)) {
      throw new Error('BB could not apply this selection. Check the current model before sending.');
    }
    selectionChanged(composer.key);
  }
  return {
    statuses, scopeReason, daybreak,
    async models(providerId: string) {
      return (await executionOptions(providerId)).models;
    },
    async catalog() {
      const initial = await executionOptions(composer.selection?.providerId);
      return Promise.all(initial.providers.filter(provider => provider.available).map(async provider => {
        try {
          const options = provider.id === composer.selection?.providerId ? initial : await executionOptions(provider.id);
          return { providerId: provider.id, providerName: provider.displayName, models: options.models,
            error: options.modelLoadError?.detail ?? null };
        } catch (cause) {
          return { providerId: provider.id, providerName: provider.displayName, models: [],
            error: cause instanceof Error ? cause.message : 'Could not load models' };
        }
      }));
    },
    apply(favourite: Setup) {
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
        const next = nextFavourite(list, { ...composer.selection, daybreak: await daybreak() }, direction, favourite => reasons.get(favourite.id) ?? null);
        if (!next) throw new Error('No favourites are available on this machine. Open the favourites menu for details.');
        await applyChecked(next);
        composer.focus();
      });
    },
  };
}
export type Controller = ReturnType<typeof createController>;
