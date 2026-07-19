# Ecosystem configuration: gates, units, strictness, triggers

Per-package-manager detail for the controls SKILL.md names. Every claim about a
default or unit here was verified against the shipping tool or its source
(as of 2026-07-19: npm 11.16 / npm 12 GA, pnpm 11.12, bun 1.3.14, Yarn 4.12,
uv 0.11, pip 26.1, Deno 2.9, cargo 1.97, osv-scanner 2.4). Re-verify against
`--help` or the official docs when revising — these are the fastest-moving
facts in the skill.

## Contents

- [Unit conversion table](#unit-conversion-table)
- [npm](#npm)
- [pnpm](#pnpm)
- [bun](#bun)
- [Yarn](#yarn)
- [aube](#aube)
- [Deno](#deno)
- [Python: uv](#python-uv)
- [Python: pip](#python-pip)
- [Rust / Cargo](#rust--cargo)
- [Undateable sources: GitHub releases, aqua, tool managers](#undateable-sources-github-releases-aqua-tool-managers)
- [Gate-evasion and escape-hatch asymmetries](#gate-evasion-and-escape-hatch-asymmetries)

## Unit conversion table

Every manager invents its own key **and** its own unit. A 4-day quarantine is
spelled seven different ways; copying a literal between tools silently changes
the policy by orders of magnitude.

| Tool | Key | Unit | 4 days spelled as |
|---|---|---|---|
| npm (`.npmrc`) | `min-release-age` | days | `4` |
| pnpm (`pnpm-workspace.yaml` / global `config.yaml`) | `minimumReleaseAge` | minutes | `5760` |
| bun (`bunfig.toml`) | `minimumReleaseAge` | seconds | `345600` |
| Yarn 4.10+ (`.yarnrc.yml`) | `npmMinimalAgeGate` | duration string or bare minutes | `4d` (= `5760`) |
| aube (`config.toml`) | `minimumReleaseAge` | minutes | `5760` |
| uv (`uv.toml` / `pyproject.toml`) | `exclude-newer` | duration string or timestamp | `"4 days"` |
| pip (`pip.conf`) | `uploaded-prior-to` | ISO-8601 duration or datetime | `P4D` |
| Deno (`deno.json`) | `minimumDependencyAge` | duration string | `"4d"` |
| mise (`config.toml`) | `minimum_release_age` | duration string | `"4d"` |

After converting, enforce agreement mechanically: when one policy value is
hand-spelled across several configs, add a drift-guard pre-commit check — one
expected constant, one (file, regex, unit) row per config, normalise, fail on
disagreement. The mechanical-enforcement skill carries that checker pattern.

## npm

npm 12 (GA 2026-07) ships the hardened defaults; on npm ≤11 (still bundled
with current Node LTS) you must set them yourself:

```ini
# ~/.npmrc or project .npmrc — needed explicitly on npm <=11
min-release-age=4
ignore-scripts=true
allow-git=none
```

- npm 12+ defaults: install scripts and implicit `node-gyp rebuild` off,
  `--allow-git` / `--allow-remote` default `none`. `npm approve-scripts`
  writes a per-package allowlist into `package.json` — commit it so CI gets
  the same policy.
- `allow-git=none` matters even with scripts off: git dependencies can execute
  code at install regardless of lifecycle-script settings.
- No trust-policy equivalent (no provenance-downgrade check).
- Deno also reads `min-release-age` from `.npmrc` for npm dependencies, so a
  project `.npmrc` covers both.

## pnpm

pnpm 11 reads settings **only from YAML** (`pnpm-workspace.yaml`, or the
global `config.yaml`) — a `.npmrc` line is silently ignored, so an npm-style
config gives no protection while looking like it does.

```yaml
# pnpm-workspace.yaml
minimumReleaseAge: 5760          # minutes; explicit config also flips strict on
minimumReleaseAgeStrict: true    # redundant when the line above is explicit; pin it anyway
trustPolicy: no-downgrade
trustPolicyIgnoreAfter: 525600   # minutes; see below
ignoreScripts: true
blockExoticSubdeps: true         # v11 default; explicit keeps the posture auditable
```

- **Strictness is conditional**: pnpm 11 ships a built-in 1440-minute gate
  that is deliberately *non-strict* (falls back to an older satisfying
  version). Explicitly configuring `minimumReleaseAge` flips
  `minimumReleaseAgeStrict` to default `true`. Pin strict explicitly so the
  posture doesn't depend on remembering that rule.
- `trustPolicy: no-downgrade` (default `off`) fails the install when a
  package's trust evidence weakens vs earlier versions — the signature of a
  publisher takeover. Its main false-positive class is aged backports
  published without provenance (a maintainer patching an old major line);
  `trustPolicyIgnoreAfter` (minutes) skips the check for versions older than
  the window, because a real takeover is a live incident in its first days.
- Build scripts are blocked by default and `strictDepBuilds` fails *closed*
  (`ERR_PNPM_IGNORED_BUILDS`, non-zero exit) — visible in CI even when a
  global `ignoreScripts` masks it locally. Record per-package approvals in
  `pnpm-workspace.yaml` `allowBuilds` (pnpm 11 reads only the workspace YAML
  for this, not `package.json#pnpm`).
- macOS gotcha: the global config lives at `~/Library/Preferences/pnpm/config.yaml`,
  not `~/.config/pnpm/` — verify which file the tool actually reads.

## bun

```toml
# bunfig.toml
[install]
minimumReleaseAge = 345600   # seconds
```

- **Verify the gate actually applies.** bun's global-config path resolution
  is unreliable (oven-sh/bun#26408 and siblings, unfixed as of bun 1.3.14,
  2026-07):
  XDG-path configs are silently ignored, so prefer `$HOME/.bunfig.toml` and
  then confirm with a test install of a fresh package.
- A project `bunfig.toml` shallow-merges and **replaces the whole
  `[install]` table** from global config — a project file with any
  `[install]` key silently drops the global gate.
- Dependency postinstall scripts are blocked by default; allow per-package
  with `bun pm trust`. No trust-policy equivalent.
- One-off bypass: `bun install --minimum-release-age=0` (no env override).

## Yarn

Modern Yarn (4.10+) only — Yarn 1 silently ignores all of this; prefer pnpm
where a project is stuck on Yarn 1.

```yaml
# .yarnrc.yml
npmMinimalAgeGate: 4d   # duration string; a bare number means minutes
```

- The value is a duration setting with base unit minutes: `5760` and `4d`
  are equivalent. Current Yarn ships a built-in `1d` default.
- `npmPreapprovedPackages` (array of descriptors or name globs) is the
  scoped exception vehicle — it exempts matches from all package gates.

## aube

```toml
# aube config.toml
minimumReleaseAge = 5760          # minutes
minimumReleaseAgeStrict = true    # REQUIRED: aube's gate is advisory by default
advisoryBloomCheck = "on"         # OSV MAL-* bloom prefilter on lockfile installs
```

- **The gate defaults to advisory**: without `minimumReleaseAgeStrict = true`
  aube silently falls back to the next-oldest satisfying version. This is the
  canonical "gate set ≠ fail closed" case — setting the age key alone changes
  resolution preference, not enforcement.
- `trustPolicy = "no-downgrade"` is the default; scope exceptions via
  `trustPolicyExclude` with the reasoning in a config comment.
- `lowDownloadThreshold` refuses very-low-download packages (typosquat
  defence); allowlist genuine niche tools via `allowedUnpopularPackages`.
- Lifecycle scripts are blocked unless allowed per-package (`allowBuilds` /
  `aube approve-builds`).

## Deno

Deno 2.9+ has the age gate **on by default** (24h) for npm dependencies, even
unconfigured. Precedence: CLI flag → `deno.json` `minimumDependencyAge` →
`.npmrc` `min-release-age` → env → the 1440-minute default. One-off bypass:
`deno install --minimum-dependency-age=0`. Lifecycle scripts always require
explicit `--allow-scripts`.

## Python: uv

```toml
# uv.toml or [tool.uv] in pyproject.toml
exclude-newer = "4 days"
```

- **Resolution-only**: `exclude-newer` applies when uv resolves
  (`uv lock`, `uv lock --upgrade`, `uv add`), and is completely blind to
  `uv sync --frozen` — the frozen path installs whatever the lockfile pins,
  including a direct object-storage URL that survived registry takedown.
- Cover the frozen path with `UV_MALWARE_CHECK=1` (env; preview feature as of
  uv 0.11, 2026-07 — `--preview-features malware-check` silences the
  warning): on
  every sync uv checks the locked resolution against OSV `MAL-*` advisories
  and aborts *before download*. PyPI-sourced + known-malware only — it
  complements the age gate (pre-advisory window) and a full osv-scanner
  sweep, it does not replace them. `UV_MALWARE_CHECK=0` is the one-off
  bypass.
- Python's load-time triggers are broader than npm's: `.pth` files execute on
  *any* interpreter startup with no import required, and import hooks and
  top-level module code run on first import. No install-script switch closes
  these — they are the reason the detective layer and containment matter in
  Python even with a gate configured.

## Python: pip

```ini
# pip.conf
[install]
uploaded-prior-to = P4D
```

Applies to `pip install`, `pip download`, and `pip wheel` — but only against
indexes that expose upload-time metadata. Private mirrors and proxies that
strip it leave the gate silently inert. Prefer uv where possible; its
lockfile makes the resolution auditable.

## Rust / Cargo

Cargo is the ecosystem without a stable proactive gate, and `build.rs` plus
proc-macros run arbitrary code at *compile* time with no global off-switch.

- Age gate: `-Zmin-publish-age` is nightly-only (tracking
  rust-lang/cargo#17009, still open as of cargo 1.97, 2026-07). The registry
  `pubtime`
  groundwork has stabilised (lazily backfilled, partial coverage) — recheck
  the issue before claiming "no gate" in future.
- Working controls today: exact pins in `Cargo.toml`, committed `Cargo.lock`,
  osv-scanner over `Cargo.lock`, and building vendored/pinned source (a
  Nix-style pinned+hashed source rev makes the vetted revision the
  checkpoint instead of a fresh crates.io resolution).
- `cargo-deny` licence/advisory/ban policy lives with the linter-shaped
  controls in the mechanical-enforcement skill — don't duplicate it here.
- Sandbox builds of untrusted crates: `build.rs` at compile time has the same
  privileges as an install script, so compile untrusted code inside the same
  containment you'd give an install.

## Undateable sources: GitHub releases, aqua, tool managers

GitHub-release and aqua-style backends (and tool managers like mise
installing from them) often expose no reliable publish-time metadata to gate
on — and even where a manager offers an age gate, it applies at *resolution*
time. For these, **the exact pin is the control**: a committed lockfile with
per-platform checksums, plus provenance/attestation verification at install
where the backend supports it (GitHub artifact attestations, SLSA). Two
caveats to carry:

- Checksums recorded for *other* platforms from registry metadata are not
  verified by download until a machine of that platform installs — the
  install-time attestation check is what actually fires there.
- A lockfile-hit checksum match can skip provenance re-verification unless
  the tool is told otherwise (e.g. mise `locked_verify_provenance`) — check
  whether your tool re-verifies on lockfile hits or only on first resolve.

## Gate-evasion and escape-hatch asymmetries

Two asymmetries decide how an exception should be made (the *discipline* for
making them is in [exceptions.md](exceptions.md)):

**One-off escape hatches are unevenly available.** Some tools have an
ephemeral bypass that leaves no trace; others force a config edit — which is
better, because it's reviewable and revertible:

| Tool | One-off bypass | Tracked exception vehicle |
|---|---|---|
| npm | `--before` date pinning (no age-gate env override) | project `.npmrc`; `npm approve-scripts` allowlist |
| pnpm | CLI/env per install | `minimumReleaseAgeExclude`, `allowBuilds` |
| bun | `--minimum-release-age=0` | project `bunfig.toml` (replaces whole `[install]` table — re-state the gate) |
| Yarn | — | `npmPreapprovedPackages` |
| aube | — | `minimumReleaseAgeExclude`, `trustPolicyExclude`, `allowBuilds` |
| uv | `UV_MALWARE_CHECK=0`, `--exclude-newer` override | `[tool.uv]` per-project |
| pip | CLI flag override | project `pip.conf` |
| Deno | `--minimum-dependency-age=0` | `deno.json` |

**Enforcement point differs.** Resolution-time gates (uv, npm/pnpm ranges)
don't protect frozen/lockfile installs; install-time checks (malware check,
attestations) do. When auditing a setup, ask of each control: does it fire on
the path CI actually takes?
