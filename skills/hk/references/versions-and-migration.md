# Versions and migration

Use this reference when maintaining v1, resolving a version mismatch or carrying
out a requested v2 upgrade. New configurations use v2. Maintenance preserves
the repository's selected version and hook contract.

## Select the version before editing

Compare the repository's mise pin and lockfile, `hk --version`, and the versions
in both Pkl URLs. Run the repository-selected binary, not an unrelated global
one. Inspect `hk.local.pkl`, `.config/hk.local.pkl` and any `HK_FILE` override
when the effective configuration differs from the shared file.

Do not repair a mismatch by upgrading the repository without an upgrade request.
Use the pinned runtime to validate its schema first. For a requested upgrade,
update the tool pin, lockfile and schema URLs together, then verify behaviour.
Resolve version availability from the tool and upstream releases; the versions
in these examples are reproducible verification targets, not a latest-version
lookup.

## Maintain v1

This minimal explicit-hook configuration is verified with hk 1.56.1 on
2026-09-20. Preserve a maintained repository's existing version, hook settings
and step membership; this is a syntax example, not a replacement configuration.

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.56.1/hk@1.56.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.56.1/hk@1.56.1#/Builtins.pkl"

local shared_steps = new Mapping<String, Step> {
    ["trailing-whitespace"] = Builtins.trailing_whitespace
    ["newlines"] = Builtins.newlines
    ["check-merge-conflict"] = Builtins.check_merge_conflict
}

hooks {
    ["check"] { steps = shared_steps }
    ["fix"] { fix = true; steps = shared_steps }
    ["pre-commit"] { fix = true; stash = "git"; steps = shared_steps }
}
```

Top-level shared `steps` and the v2 builtin-option spellings are not v1 syntax.
Check a builtin in the tagged schema used by that repository before adding it.
The wrapper's quiet-on-success contract needs hk 1.51.0 or later. On older
pins, keep existing output behaviour and report that limit rather than forcing
an upgrade. Standalone Pkl is backend-dependent in v1; inspect the selected
version and `HK_PKL_BACKEND` before changing its dependencies.

## Migrate to v2

1. Record each hook's steps, check/fix mode, stash method and expected index
   changes. Include custom hooks and scripts calling `hk fix`. Capture plans
   with the old runtime before changing the pin.
2. Replace removed interfaces that the repository actually uses. Check the
   [official migration table](https://hk.jdx.dev/migration-v2#configuration-files)
   for legacy TOML/YAML/JSON, `.hkrc.pkl`, `UserConfig.pkl`, `Regex` helpers and
   `hk generate`. V2 uses its embedded evaluator; remove `HK_PKL_BACKEND=pkl`.
   Remove standalone Pkl only if nothing else in the repository needs it.
3. Update the selected runtime and both schema URLs. Replace removed builtin
   names using the table below. Preserve custom commands and their scan scope.
4. Preserve hook layout. Top-level `steps` is optional. Move checks there only
   when check, fix and pre-commit should all inherit them. Keep event-specific
   guards in their explicit hooks. An explicit hook replaces a same-named
   shared step entirely, but still inherits other shared names.
5. Restore intended staging explicitly. V2 stages by default only for
   pre-commit. Set hook `stage = true` when another hook must retain automatic
   staging, or use `hk fix --stage` for an individual invocation. A step's
   `stage` patterns only restrict paths; they do not enable staging.
6. Validate with the selected runtime, compare hook plans, then run checks and
   disposable fix/partial-staging fixtures. Inspect both the working tree and
   index. Use `hk test --list` before running the intended step tests.

`hk migrate pre-commit` imports the separate pre-commit tool's configuration.
It does not migrate hk v1 to v2.

| Removed builtin | V2 spelling |
| --- | --- |
| `Builtins.gitleaks_staged` | `(Builtins.gitleaks) { scan = "staged" }` |
| `Builtins.knip_strict` | `(Builtins.knip) { strict = true }` |
| `Builtins.pinact_v3` | `(Builtins.pinact) { version = "3" }` |
| `Builtins.pinact_update_v3` | `(Builtins.pinact_update) { version = "3" }` |
| `Builtins.check_byte_order_marker`, `Builtins.fix_byte_order_marker` | `Builtins.byte_order_marker` |

Do not replace a custom `gitleaks detect` history scan with the v2 builtin as
part of a syntax update. The builtin's default scans the working tree and its
`scan = "staged"` option scans the index. Preserve history scanning unless the
user requests a scope change.

## Runtime checks that distinguish the behaviours

Run these in a disposable repository with user/global hk configuration isolated:

| Scenario | V2 expectation |
| --- | --- |
| Shared steps, no explicit hooks | Check, fix and pre-commit exist; pre-push does not |
| Explicit hook-only configuration | Only declared hooks exist |
| `hk fix` with a matching step `stage` pattern | Worktree changes; index stays unchanged |
| `hk fix --stage` or a fixing hook with `stage = true` | Applicable fixes reach the index |
| Partially staged pre-commit fixture | Staged content is fixed; unrelated unstaged edits survive |
| `hk check --all`, no stashing, untracked discovery enabled | Tracked and eligible untracked files are selected |
| `--all` with stashing, or `HK_STASH_UNTRACKED=0` | Untracked files are not selected |

When results differ, inspect `hk config explain` and the hook plan before
changing globs. Runtime settings can override hook staging and stashing.

A partial-staging probe on hk 2.0.1, verified on 2026-09-20, restores the
original worktree whitespace alongside the unrelated unstaged edit, while
the index contains the whitespace fix. Check the index and worktree
separately; do not require the restored worktree to equal the fixed index.

## Sources

- [V2 migration guide](https://hk.jdx.dev/migration-v2)
- [Hook defaults and overrides](https://hk.jdx.dev/configuration#hook-defaults)
- [File selection and stashing](https://hk.jdx.dev/hooks#file-selection)
- [Tagged v2.0.1 implementation](https://github.com/jdx/hk/tree/v2.0.1)
