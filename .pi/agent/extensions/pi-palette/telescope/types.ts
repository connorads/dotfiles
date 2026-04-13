/**
 * Telescope Types
 *
 * Core interfaces for the fuzzy finder provider system.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";

/** An action available for a provider's items. */
export interface ProviderAction {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * A data provider for the telescope fuzzy finder.
 *
 * Each provider supplies items, defines display/search/preview,
 * and handles selection.
 */
export interface TelescopeProvider<T = unknown> {
  readonly name: string;
  readonly icon: string;
  readonly description: string;

  load(cwd: string): T[] | Promise<T[]>;
  searchText(item: T): string;
  displayText(item: T, theme: Theme, highlighted?: string): string;
  onSelect(item: T, ctx: ExtensionContext): void | Promise<void>;

  preview?(item: T, maxLines: number, theme: Theme): string[] | null;

  /** If true, telescope calls search() per keystroke instead of filtering pre-loaded items. */
  supportsDynamicSearch?: boolean;
  search?(query: string, cwd: string): Promise<T[]>;

  onMultiSelect?(items: T[], ctx: ExtensionContext): void | Promise<void>;

  actions?: readonly ProviderAction[];
  onAction?(key: string, items: T[], ctx: ExtensionContext): void | Promise<void>;

  frecencyKey?(item: T): string;
}

/** A scored item after fuzzy matching. */
export interface ScoredItem<T = unknown> {
  readonly item: T;
  readonly score: number;
  /** Character indices that matched the query (for highlighting). */
  readonly indices: readonly number[];
}

/** Options passed to openTelescope. */
export interface TelescopeOptions {
  readonly allProviders?: Record<string, () => TelescopeProvider>;
  readonly initialQuery?: string;
}
