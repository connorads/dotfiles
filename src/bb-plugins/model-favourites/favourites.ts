import type { ComposerSelection } from '@get-bb/plugin-sdk/app';
import { setupSchema, type Favourite, type Setup } from './contracts.ts';

export function capture(selection: ComposerSelection | null): Setup {
  if (!selection?.providerId || !selection.model) throw new Error('Choose a model before saving a favourite.');
  return setupSchema.parse({
    providerId: selection.providerId, model: selection.model,
  });
}

export function matches(favourite: Setup, selection: ComposerSelection | null): boolean {
  return selection !== null && (['providerId', 'model'] as const)
    .every(field => favourite[field] === undefined || favourite[field] === selection[field]);
}

export type Catalog = {
  available: boolean;
  error: string | null;
  models: readonly {
    model: string;
  }[];
};

export function availability(favourite: Setup, catalog: Catalog): string | null {
  if (catalog.error) return catalog.error;
  if (!catalog.available) return 'Provider unavailable on this machine';
  const model = catalog.models.find(m => m.model === favourite.model);
  if (!model) return 'Model unavailable on this machine';
  return null;
}

export function nextFavourite(
  favourites: readonly Favourite[], selection: ComposerSelection | null, direction: -1 | 1,
  unavailable: (favourite: Favourite) => string | null,
): Favourite | null {
  const ordered = [...favourites].sort((a, b) => a.slot - b.slot);
  const current = ordered.findIndex(f => matches(f, selection));
  const start = current === -1 ? (direction === 1 ? -1 : 0) : current;
  for (let step = 1; step <= ordered.length; step++) {
    const index = (start + direction * step + ordered.length) % ordered.length;
    const favourite = ordered[index];
    if (favourite && !unavailable(favourite)) return favourite;
  }
  return null;
}
