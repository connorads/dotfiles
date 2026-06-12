// Domain types for skl. All pure data — values passed across the core/shell
// boundary, never objects with behaviour.

/** A configured root directory of skills, with a short label (the source name). */
export interface Source {
  /** Absolute, tilde-expanded path to the source root. */
  readonly path: string;
  /** Label used in `source/name` identity and display. */
  readonly name: string;
}

/** A skill discovered under a source: identity `(source, name)` plus render data. */
export interface DiscoveredSkill {
  readonly source: Source;
  /** From SKILL.md frontmatter `name`, falling back to the dir basename. */
  readonly name: string;
  /** From frontmatter `description`, flattened later for display. `""` if absent. */
  readonly description: string;
  /** Absolute directory containing SKILL.md. */
  readonly dir: string;
  /** File paths relative to `dir` (includes SKILL.md), sorted, for the tree. */
  readonly files: readonly string[];
}

/** A parsed reference token from the CLI. */
export type SkillRef =
  | { readonly kind: "bare"; readonly name: string }
  | { readonly kind: "qualified"; readonly source: string; readonly name: string };

/** The minimal payload injected on load (progressive disclosure). */
export interface Pointer {
  /** Sent as visible literal keystrokes so stacked skills stay identifiable. */
  readonly skillName: string;
  /** Description + tree + instruction, sent as a (collapsible) bracketed paste. */
  readonly bulk: string;
}

/** Validated configuration: ordered sources (order = precedence). */
export interface Config {
  readonly sources: readonly Source[];
}

/** Frontmatter fields we care about. `name` may be absent (→ fallback). */
export interface Frontmatter {
  readonly name: string | null;
  readonly description: string;
}

export type FrontmatterError =
  | { readonly kind: "no-frontmatter" }
  | { readonly kind: "yaml-error"; readonly message: string }
  | { readonly kind: "name-not-string" };

export type ResolveError =
  | { readonly kind: "not-found"; readonly name: string }
  | { readonly kind: "source-unknown"; readonly source: string };

export type ConfigError =
  | { readonly kind: "not-object" }
  | { readonly kind: "paths-not-array" }
  | { readonly kind: "empty" }
  | { readonly kind: "path-not-object"; readonly index: number }
  | { readonly kind: "path-missing"; readonly index: number }
  | { readonly kind: "name-not-string"; readonly index: number };

/** Options shared across commands. */
export interface Options {
  readonly target: string | null;
  /** `--path` overrides config entirely (no merge). Empty = use config file. */
  readonly paths: readonly string[];
  readonly submit: boolean;
  /** Copy pointer(s) to the system clipboard instead of injecting into a pane. */
  readonly copy: boolean;
}

/** A fully-parsed CLI invocation. `load.ref` is null when refs come from stdin. */
export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "list"; readonly options: Options }
  | { readonly kind: "load"; readonly ref: string | null; readonly options: Options }
  | { readonly kind: "preview"; readonly ref: string; readonly options: Options };

export type ArgError =
  | { readonly kind: "missing-value"; readonly flag: string }
  | { readonly kind: "unknown-flag"; readonly flag: string }
  | { readonly kind: "too-many-args"; readonly args: readonly string[] };
