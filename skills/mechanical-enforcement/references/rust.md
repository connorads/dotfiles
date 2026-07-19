# Mechanical Enforcement — Rust

Per-stack rules for Rust: clippy correctness, complexity thresholds, pedantic
allows, workspace lint wiring, supply chain, unused deps, and crate boundaries.
Routed from the picks table and rules-catalogue index in `SKILL.md`.

- [Type safety & correctness](#type-safety--correctness)
- [Complexity thresholds (clippy.toml)](#complexity-thresholds-clippytoml)
- [Common pedantic allows](#common-pedantic-allows)
- [Workspace lint wiring](#workspace-lint-wiring)
- [Supply chain (cargo-deny)](#supply-chain-cargo-deny)
- [Unused dependencies (cargo-machete)](#unused-dependencies-cargo-machete)
- [Boundaries](#boundaries)

## Type safety & correctness

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Deny all default warnings | `clippy -D warnings` | Warnings accumulating silently | Non-negotiable baseline. |
| Pedantic lints (selective) | `[workspace.lints.clippy] pedantic = { level = "warn", priority = -1 }` | Broader code quality issues | Start at `warn`, promote to `deny` once clean. Allow noisy lints per-project — see common allows table below. |
| Unused results | clippy `let_underscore_must_use`, `unused_results` | Silently discarding important return values | Complements `#[must_use]` annotations. |
| Unsafe visibility | `[workspace.lints.rust] unsafe_code = "warn"` | Unsafe blocks spreading unnoticed | `warn` not `deny` — FFI crates need escape hatch with per-crate override. |

## Complexity thresholds (clippy.toml)

All settings go in `clippy.toml` at the workspace root. See `references/clippy-thresholds.toml` for a drop-in file.

| Setting | Default | Recommended | Prevents |
|---|---|---|---|
| `too-many-lines-threshold` | 100 | 100 | Functions too long to review in one screen. Per-fn `#[allow(clippy::too_many_lines)]` for faithful translations (e.g. ASM ports). |
| `too-many-arguments-threshold` | 7 | 7 | God-functions with too many inputs. |
| `cognitive-complexity-threshold` | 25 | 25 | Deeply nested/branching logic. |
| `type-complexity-threshold` | 250 | 250 | Deeply nested generics. |
| `max-fn-params-bools` | 3 | 3 | Boolean-parameter blindness. |
| `max-struct-bools` | 3 | 3 | Structs that should use enums instead. |
| `disallowed-names` | `["foo","baz","quux"]` | `["foo","bar","baz","quux"]` | Placeholder names leaking into prod. |

## Common pedantic allows

When enabling `clippy::pedantic`, these lints are typically too noisy. Allow them at workspace level and document why so projects don't re-derive the set. See `references/rust-workspace-lints.toml` for a drop-in config.

| Lint | When to allow | Why |
|---|---|---|
| `cast-possible-truncation` | Numeric/embedded/emulator code | Intentional width casts are the norm |
| `cast-possible-lossless` | Same | Would flag every `u8 as u16` |
| `cast-precision-loss` | Float/audio/timing code | `f64 as f32` is intentional |
| `cast-sign-loss` | Bitwise/register code | `i32 as u32` is intentional |
| `module-name-repetitions` | Always | Idiomatic Rust (`error::Error`) |
| `must-use-candidate` | Always | Too many suggestions, low signal |
| `missing-errors-doc` | Non-library crates | Only useful for published APIs |
| `missing-panics-doc` | Non-library crates | Same |
| `similar-names` | Domain code with similar identifiers | Register names, coordinate pairs |
| `unreadable-literal` | Code with hex addresses/constants | `0x3CD70` shouldn't need `0x0003_CD70` |
| `wildcard-imports` | Test modules, enum re-exports | Common Rust pattern |
| `struct-excessive-bools` | State/config structs | Game state, feature flags |

## Workspace lint wiring

Requires Rust 1.74+. Define lints once in root `Cargo.toml`, inherit in each crate. FFI/sys crates get per-crate overrides. See `references/rust-workspace-lints.toml` for a complete template.

```toml
# Root Cargo.toml
[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
# ... project-specific allows ...

[workspace.lints.rust]
unsafe_code = "warn"

# Each crate's Cargo.toml
[lints]
workspace = true

# FFI crate override example
[lints.clippy]
missing-safety-doc = "allow"
```

## Supply chain (cargo-deny)

[cargo-deny](https://github.com/EmbarkStudios/cargo-deny) enforces dependency policy. See `references/cargo-deny.toml` for a template `deny.toml`. Licence/advisory/ban gates stay here; broader dependency posture (age gates, lockfile pinning, osv-scanner, exceptions) is the supply-chain-hardening skill's domain.

| Concern | Config section | What it catches | Notes |
|---|---|---|---|
| Known vulnerabilities | `[advisories]` | CVEs in transitive deps via RustSec DB | Set `severity = "low"` to flag everything. |
| Licence compliance | `[licenses]` with allowlist | Unapproved or missing SPDX licences | Use `[[licenses.clarify]]` for deps with missing metadata. |
| Banned crates | `[bans]` | Specific crates (e.g. `openssl` → use `rustls`) or duplicate versions | `multiple-versions = "warn"` catches dep tree bloat. |
| Registry restriction | `[sources]` | Deps from unknown registries or git repos | `unknown-registry = "deny"`, `unknown-git = "warn"`. |

## Unused dependencies (cargo-machete)

clippy and cargo-deny don't flag dependencies declared in `Cargo.toml` but never
used. [cargo-machete](https://github.com/bnjbvr/cargo-machete) does — a fast,
text-level scan that gates on a non-zero exit (`cargo machete`) and removes them
with `--fix`. Fewer deps means a smaller build and attack surface.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No unused deps | `cargo machete` (tier-4 hygiene) | Dead dependencies bloating the build and attack surface | False positives for deps used only via proc-macros / build scripts — suppress narrowly with `[package.metadata.cargo-machete] ignored`. |
| Exhaustive variant | `cargo udeps` on demand | Missed unused deps from machete's text-level scan | More precise but needs nightly + a full compile; too slow for a default hook, so keep it on-demand. |

## Boundaries

There is no import-linter equivalent — the pattern is structural. Make layers
separate workspace crates so the compiler enforces the DAG (the domain crate
simply has no path to infra). Back it with cargo-deny `[bans]` `wrappers`
("only app/api may depend on infra" — see `references/cargo-deny.toml`),
`cargo modules dependencies --acyclic` in CI where layering matters, and clippy
`disallowed-types` / `disallowed-methods` for coarse in-crate bans (see
`references/clippy-thresholds.toml`). cargo-pup (declarative architecture
lints; nightly-only) is a watch.

The cross-stack boundary philosophy lives in
`references/architecture-boundaries.md`.
