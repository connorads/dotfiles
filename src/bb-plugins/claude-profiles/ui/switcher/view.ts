import type { KeyedProfile } from '../../contracts.ts';
import type { Usage } from '../../src/accounts/quota.ts';
import type { Effort, Favourite, Setup } from '../../src/models/contract.ts';
import { availability, matches } from '../../src/models/favourites.ts';

export type CatalogModel = {
  model: string;
  displayName?: string | null;
  defaultReasoningEffort: Effort;
  supportedReasoningEfforts: readonly { reasoningEffort: Effort }[];
  supportedServiceTiers?: readonly { id: string; label?: string | null }[] | null;
  sessionOptions?: readonly { id: string; type: string; value: string | boolean; fixed?: boolean }[];
};
export type ProviderCatalog = { providerId: string; providerName: string; models: readonly CatalogModel[]; error: string | null };
export type Current = { providerId: string | undefined; model: string | undefined; reasoningLevel: string | null | undefined;
  serviceTier: string | null | undefined; daybreak: boolean | undefined };

export const isGo = (providerId: string | undefined, model: string | undefined) => providerId === 'acp-opencode' && Boolean(model?.startsWith('opencode-go/'));

// The harness name, refined for OpenCode, whose one provider fronts several subscriptions.
export function providerLabel(catalog: readonly ProviderCatalog[], providerId: string, model: string): string {
  if (providerId === 'acp-opencode') {
    if (isGo(providerId, model)) return 'OpenCode Go';
    if (model.startsWith('opencode/')) return model.endsWith('-free') ? 'OpenCode Free' : 'OpenCode';
  }
  return catalog.find(p => p.providerId === providerId)?.providerName ?? providerId;
}

export function modelOf(catalog: readonly ProviderCatalog[], providerId: string | undefined, model: string | undefined) {
  return catalog.find(p => p.providerId === providerId)?.models.find(m => m.model === model);
}

export function displayName(catalog: readonly ProviderCatalog[], setup: Setup): string {
  return `${modelOf(catalog, setup.providerId, setup.model)?.displayName ?? setup.model}${setup.daybreak ? ' · Daybreak' : ''}`;
}

export type Row = {
  id: string; setup: Setup; slot: number | null; name: string; providerId: string; provider: string;
  levels: Effort[]; effort: Effort | null; selected: boolean; reason: string | null;
};

// Favourites in slot order; the current model leads when it is not a favourite, so ⌘S can keep it.
export function quickRows(favourites: readonly Favourite[], catalog: readonly ProviderCatalog[], current: Current,
  scopeReason: (setup: Setup) => string | null): Row[] {
  const selection = current.providerId && current.model ? { providerId: current.providerId, model: current.model } : null;
  const levelsOf = (setup: Setup) => modelOf(catalog, setup.providerId, setup.model)?.supportedReasoningEfforts.map(e => e.reasoningEffort) ?? [];
  const rows: Row[] = [...favourites].sort((a, b) => a.slot - b.slot).map(favourite => {
    const selected = matches(favourite, selection as never, current.daybreak);
    const provider = catalog.find(p => p.providerId === favourite.providerId);
    return { id: favourite.id, setup: favourite, slot: favourite.slot, name: displayName(catalog, favourite),
      providerId: favourite.providerId, provider: providerLabel(catalog, favourite.providerId, favourite.model),
      levels: levelsOf(favourite), effort: selected ? current.reasoningLevel ?? null : favourite.reasoningLevel ?? null, selected,
      reason: provider ? scopeReason(favourite) ?? availability(favourite, { available: true, error: provider.error, models: provider.models }) : 'Provider unavailable on this machine' };
  });
  if (selection && !rows.some(row => row.selected)) {
    const setup: Setup = { ...selection, ...(current.daybreak ? { daybreak: true } : {}) };
    rows.unshift({ id: 'current', setup, slot: null, name: displayName(catalog, setup), providerId: selection.providerId,
      provider: providerLabel(catalog, selection.providerId, selection.model), levels: levelsOf(setup),
      effort: current.reasoningLevel ?? null, selected: true, reason: null });
  }
  return rows;
}

function savedSlot(favourites: readonly Favourite[], providerId: string, model: string, daybreak: boolean): number | null {
  for (const f of favourites) if (f.providerId === providerId && f.model === model && (f.daybreak ?? false) === daybreak) return f.slot;
  return null;
}

export type Result = { id: string; setup: Setup; name: string; slot: number | null };
export type Group = { providerId: string; provider: string; error: string | null; results: Result[] };

// Search matches model, provider and route names. A failed catalogue shows only when its provider is searched for.
// A standard result states Daybreak off only where BB can apply it: a thread already on that provider.
export function searchGroups(catalog: readonly ProviderCatalog[], favourites: readonly Favourite[], query: string, applyOff: (providerId: string) => boolean): Group[] {
  const search = query.trim().toLowerCase();
  return catalog.flatMap((provider): Group[] => {
    if (provider.error) return provider.providerName.toLowerCase().includes(search) && search
      ? [{ providerId: provider.providerId, provider: provider.providerName, error: provider.error, results: [] }] : [];
    const results = provider.models.flatMap(model => {
      const option = model.sessionOptions?.find(o => o.id === 'daybreak' && o.type === 'boolean');
      const programmes = option ? (option.fixed ? [option.value === true] : [false, true]) : [false];
      return programmes.map(programme => {
        const setup: Setup = { providerId: provider.providerId, model: model.model, ...(option && (programme || applyOff(provider.providerId)) ? { daybreak: programme } : {}) };
        return { id: `${provider.providerId}:${model.model}:${programme}`, setup, name: displayName(catalog, setup),
          slot: savedSlot(favourites, setup.providerId, setup.model, programme) };
      });
    }).filter(result => `${result.name} ${result.setup.model} ${provider.providerName} ${providerLabel(catalog, provider.providerId, result.setup.model)}`
      .toLowerCase().includes(search));
    return results.length ? [{ providerId: provider.providerId, provider: provider.providerName, error: null, results }] : [];
  });
}

// Effort steps from the model's lightest to heaviest level; it never steps off either end.
export function stepEffort(levels: readonly Effort[], current: Effort | null, direction: -1 | 1, fallback: Effort): Effort | null {
  if (!levels.length) return null;
  const index = levels.indexOf(current ?? fallback);
  const next = levels[Math.max(0, Math.min(levels.length - 1, (index === -1 ? levels.indexOf(fallback) : index) + direction))];
  return next ?? null;
}

export type Tone = 'normal' | 'warning' | 'critical' | 'unknown';
export function ring(usage: Usage | undefined): { percent: number | null; tone: Tone; label: string } {
  if (!usage || usage.status !== 'ok' || !usage.windows.length) return { percent: null, tone: 'unknown', label: usage?.message ?? 'Usage unavailable' };
  const percent = Math.max(...usage.windows.map(w => w.usedPercent));
  const tone = percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'normal';
  const label = usage.windows.map(w => `${w.id === 'five_hour' ? '5h' : w.id.startsWith('seven_day') ? 'week' : w.label} ${Math.round(w.usedPercent)}%`).join(' · ');
  return { percent, tone, label };
}

export type AccountChip = { profile: KeyedProfile; selected: boolean; pending: boolean; connectors: boolean };
// The account row exists only when the current model's provider offers a choice of accounts.
export function accountChips(providerId: string | undefined, accounts: { profiles: readonly KeyedProfile[]; currentId: string; pendingId: string | null } | null,
  connectors: Readonly<Record<string, boolean>>): AccountChip[] {
  if (providerId !== 'claude-code' || !accounts || accounts.profiles.length < 2) return [];
  const shown = accounts.pendingId ?? accounts.currentId;
  return accounts.profiles.map(profile => ({ profile, selected: profile.id === shown, pending: profile.id === accounts.pendingId,
    connectors: connectors[profile.id] === true }));
}
