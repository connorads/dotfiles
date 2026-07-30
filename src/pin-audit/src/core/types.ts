// The domain of a conditional-pin audit: what the config says, what upstream
// says, and the verdict that follows. All three are values, so `judge` (see
// checks.ts) is a pure function of data and needs no probe stubbing to test.

/**
 * A normalised `[tools]` entry. mise accepts both a bare version string
 * (`"npm:x" = "1.2.3"`) and a table (`"pipx:y" = { version = "2", ... }`);
 * both parse into this one shape at the boundary.
 */
export interface ToolEntry {
  /** null when the entry carries no version key. */
  readonly version: string | null;
  /** `prerelease = true`; absent means false. */
  readonly prerelease: boolean;
}

/** The subset of a mise config this audit reads, plus where it came from. */
export interface MiseConfig {
  /** Path the config was read from - quoted back in verdict details. */
  readonly path: string;
  readonly tools: Readonly<Record<string, ToolEntry>>;
}

/** What the config currently says about a conditional pin. */
export type PinState =
  /** The escape hatch has been removed - the check itself is now droppable. */
  | { readonly kind: "gone" }
  /** An exact version pin. */
  | { readonly kind: "pinned"; readonly version: string }
  /** A boolean escape hatch, e.g. `prerelease = true`. */
  | { readonly kind: "flagSet" };

/** What upstream told us. Probe failure is a value, never a throw. */
export type Probe =
  /** Offline, unauthenticated, or the tool is absent. Degrades to SKIP. */
  | { readonly kind: "unavailable"; readonly why: string }
  /** Newest version upstream publishes; null when the listing was empty. */
  | { readonly kind: "latestVersion"; readonly version: string | null }
  /** Newest versioned non-prerelease tag; null when none exists yet. */
  | { readonly kind: "stableRelease"; readonly tag: string | null };

/**
 * OK   condition still holds, keep the pin
 * FLAG condition cleared, loosen/remove the pin
 * INFO not mechanically checkable, guard restated for manual recheck
 * SKIP probe failed (offline / gh auth)
 */
export type Verdict =
  | { readonly kind: "ok"; readonly detail: string }
  | { readonly kind: "flag"; readonly detail: string }
  | { readonly kind: "info"; readonly detail: string }
  | { readonly kind: "skip"; readonly detail: string };
