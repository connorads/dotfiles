// Pure planning for `skl install`: turn resolved skills into per-source install
// groups. Each group maps to one `skills add <sourceRoot> --skill <names…>` call
// in the shell — grouping by source root because that root is the local directory
// `skills add` scans (it treats a local path as a `sourceType: "local"` source and
// copies the vetted bytes in place, no fetch). Pure: no I/O, so it unit-tests
// without a stub binary.

import type { DiscoveredSkill } from "./types.ts";

/** One `skills add` invocation: a source root plus the skill names to copy from it. */
export interface InstallGroup {
  /** The local source root `skills add` scans (a skl source's `path`). */
  readonly sourceRoot: string;
  /** Skill names within that root to install (`--skill` tokens), in input order. */
  readonly names: readonly string[];
  /** Install into the global autoload dir (`-g`) rather than the project. */
  readonly global: boolean;
}

export const buildInstallPlan = (
  skills: readonly DiscoveredSkill[],
  opts: { readonly global: boolean },
): InstallGroup[] => {
  // Map preserves first-seen key order, so groups follow the resolved-skill order.
  const byRoot = new Map<string, string[]>();
  for (const skill of skills) {
    const names = byRoot.get(skill.source.path);
    if (names === undefined) byRoot.set(skill.source.path, [skill.name]);
    else names.push(skill.name);
  }
  return [...byRoot.entries()].map(([sourceRoot, names]) => ({
    sourceRoot,
    names,
    global: opts.global,
  }));
};
