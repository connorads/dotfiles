import type { ComposerSelection } from '@get-bb/plugin-sdk/app';
import { setupSchema, type Effort, type Setup } from './contract.ts';

export function capture(selection: ComposerSelection | null, daybreak?: boolean): Setup {
  if (!selection?.providerId || !selection.model) throw new Error('Choose a model before saving a favourite.');
  return setupSchema.parse({
    providerId: selection.providerId, model: selection.model, ...(daybreak === undefined ? {} : { daybreak }),
  });
}

export function matches(favourite: Setup, selection: ComposerSelection | null, daybreak?: boolean): boolean {
  return selection !== null && (['providerId', 'model'] as const)
    .every(field => favourite[field] === undefined || favourite[field] === selection[field])
    && (favourite.daybreak ?? false) === (daybreak ?? false);
}

export type CatalogModel = {
  model: string;
  sessionOptions?: readonly { id: string; type: string; value: string | boolean; fixed?: boolean }[];
  defaultReasoningEffort: Effort;
  supportedReasoningEfforts: readonly { reasoningEffort: Effort }[];
  supportedServiceTiers?: readonly { id: string }[] | null;
};
export type Catalog = {
  available: boolean;
  error: string | null;
  models: readonly CatalogModel[];
};

export function availability(favourite: Setup, catalog: Catalog): string | null {
  if (catalog.error) return catalog.error;
  if (!catalog.available) return 'Provider unavailable on this machine';
  const model = catalog.models.find(m => m.model === favourite.model);
  if (!model) return 'Model unavailable on this machine';
  if (favourite.daybreak !== undefined) {
    const option = model.sessionOptions?.find(option => option.id === 'daybreak' && option.type === 'boolean');
    if ((!option && favourite.daybreak) || (option?.fixed && option.value !== favourite.daybreak)) return 'Daybreak setting is not available for this model';
  }
  return null;
}

// The composer's current effort belongs to the last model, so it never carries over.
// A remembered effort or tier the model has dropped falls back to the model default.
export function planSelection(favourite: Setup, model: CatalogModel): { providerId: string; model: string; reasoningLevel: Effort; serviceTier?: string } {
  const saved = favourite.reasoningLevel;
  const reasoningLevel = saved !== undefined && model.supportedReasoningEfforts.some(e => e.reasoningEffort === saved) ? saved : model.defaultReasoningEffort;
  const tier = favourite.serviceTier;
  const serviceTier = tier !== undefined && model.supportedServiceTiers?.some(t => t.id === tier) ? tier : undefined;
  return { providerId: favourite.providerId, model: favourite.model, reasoningLevel, ...(serviceTier ? { serviceTier } : {}) };
}
