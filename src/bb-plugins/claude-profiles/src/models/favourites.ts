import type { ComposerSelection } from '@get-bb/plugin-sdk/app';
import { setupSchema, type Effort, type Favourite, type Setup } from './contract.ts';

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
};
export type Catalog = {
  available: boolean;
  error: string | null;
  models: readonly CatalogModel[];
};

export function effortReason(favourite: Setup, model: CatalogModel): string | null {
  const saved = favourite.reasoningLevel;
  if (saved === undefined || model.supportedReasoningEfforts.some(e => e.reasoningEffort === saved)) return null;
  return `Saved effort ${saved} is not available for this model`;
}

export function availability(favourite: Setup, catalog: Catalog): string | null {
  if (catalog.error) return catalog.error;
  if (!catalog.available) return 'Provider unavailable on this machine';
  const model = catalog.models.find(m => m.model === favourite.model);
  if (!model) return 'Model unavailable on this machine';
  if (favourite.daybreak !== undefined) {
    const option = model.sessionOptions?.find(option => option.id === 'daybreak' && option.type === 'boolean');
    if ((!option && favourite.daybreak) || (option?.fixed && option.value !== favourite.daybreak)) return 'Daybreak setting is not available for this model';
  }
  return effortReason(favourite, model);
}

// The composer's current effort belongs to the last model, so it never carries over.
export function planSelection(favourite: Setup, model: CatalogModel) {
  const reason = effortReason(favourite, model);
  if (reason) throw new Error(reason);
  return { providerId: favourite.providerId, model: favourite.model, reasoningLevel: favourite.reasoningLevel ?? model.defaultReasoningEffort };
}

export function nextFavourite(
  favourites: readonly Favourite[], selection: (ComposerSelection & { daybreak?: boolean }) | null, direction: -1 | 1,
  unavailable: (favourite: Favourite) => string | null,
): Favourite | null {
  const ordered = [...favourites].sort((a, b) => a.slot - b.slot);
  const current = ordered.findIndex(f => matches(f, selection, selection?.daybreak));
  const start = current === -1 ? (direction === 1 ? -1 : 0) : current;
  for (let step = 1; step <= ordered.length; step++) {
    const index = (start + direction * step + ordered.length) % ordered.length;
    const favourite = ordered[index];
    if (favourite && !unavailable(favourite)) return favourite;
  }
  return null;
}
