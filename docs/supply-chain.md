# Supply chain

Per-package-manager controls. mise, aube and `up`: [.config/mise/AGENTS.md](../.config/mise/AGENTS.md).

## Quarantine by package manager

**pnpm** (v11): global 4-day quarantine (`minimumReleaseAge: 5760`) + trust policy (`trustPolicy: no-downgrade`) + `ignoreScripts: true` in `~/.config/pnpm/config.yaml` (YAML, camelCase). Applies to all projects. `trustPolicy` blocks installs where a package's trust level has decreased (e.g., Trusted Publisher → unsigned = likely compromise); `trustPolicyIgnoreAfter: 525600` (minutes = 1 year) skips that check for versions published over a year ago - aged backports without provenance (semver@6.3.1, chokidar@4.0.3) are the check's main false-positive class, while a real takeover is a live incident in its first days. Fresh publishes stay fully gated. **v11 reads pnpm settings only from YAML** (`pnpm-workspace.yaml` / global `config.yaml`), never `.npmrc`/`rc` - the old `~/.config/pnpm/rc` is an inert v10 fallback. **macOS gotcha**: pnpm reads its global config from the native dir `~/Library/Preferences/pnpm/`, not `~/.config/pnpm/`, so the dotfile is symlinked there via nix (`home.file."Library/Preferences/pnpm/config.yaml"` in [darwin-shared.nix](../.config/nix/modules/darwin-shared.nix), `mkOutOfStoreSymlink` → the tracked `~/.config/pnpm/config.yaml`). Linux reads `~/.config/pnpm/config.yaml` natively. `blockExoticSubdeps: true` is set explicitly (it's the v11 default, but pinning it keeps the posture auditable in one place and drift-proof).

**npm**: global 4-day quarantine (`min-release-age=4`) in `~/.npmrc`. Note: npm uses `min-release-age` in **days**, pnpm uses `minimumReleaseAge` in **minutes** (5760 = 4 days). `allow-git=none` blocks Git dependencies, which can execute code even when lifecycle scripts are disabled; the paired `allow-remote=none` (npm >= 11.15, npm 12 default; values `all|none|root`) blocks remote-tarball dependencies, the sibling code-execution route. Project `.npmrc` files should set both age-gate keys if either tool might run. npm has no `trust-policy` equivalent.

**uv**: global 4-day quarantine (`exclude-newer = "4 days"`) in `~/.config/uv/uv.toml`. Applies during resolution (`uv lock`/`uv lock --upgrade`), not during `uv sync --frozen`. Paired with `UV_MALWARE_CHECK=1` ([.zshrc](../.zshrc), supply-chain env block): on every sync uv checks the locked resolution against OSV `MAL-*` advisories and aborts *before download* if a dependency matches known malware. This runs on `uv sync --frozen` too, covering the frozen-install path the resolution-time cooldown leaves unguarded (e.g. a lockfile pinning a direct object-storage URL that survives PyPI quarantine). PyPI-sourced packages + known-malware only, so it complements rather than replaces the cooldown (pre-advisory window) and `mise run supply-audit` (osv-scanner, general vulns + non-PyPI). This is the uv analogue of aube's `advisoryBloomCheck`. Preview feature; `UV_MALWARE_CHECK=0` bypasses a one-off.

**pip**: global 4-day quarantine (`uploaded-prior-to = P4D`) in `~/.config/pip/pip.conf`. Applies to `pip install`, `pip download`, and `pip wheel` when installing from indexes that expose upload-time metadata. `uv` remains preferred for Python projects because lockfile resolution is easier to audit.

**bun**: global 4-day quarantine (`minimumReleaseAge = 345600`, seconds) in `~/.bunfig.toml` for direct `bun` use (mise uses aube as the npm backend). **Must be `$HOME/.bunfig.toml`** - bun 1.3.14 silently ignores `$XDG_CONFIG_HOME/.bunfig.toml` ([oven-sh/bun#26408](https://github.com/oven-sh/bun/issues/26408)). Bun blocks dependency postinstall scripts by default; allow with `bun pm trust`. No `trust-policy` equivalent exists. **Caveat**: project-local `bunfig.toml` shallow-merges and *replaces* the whole `[install]` table from global. For urgent one-offs, use `bun install --minimum-release-age=0`; there is no known env override like npm/pnpm/uv/pip expose.

**Deno**: Deno 2.8+ reads `min-release-age` from `.npmrc` for npm dependencies. `deno install --minimum-dependency-age=0` disables it for an explicit one-off. Lifecycle scripts still require explicit `--allow-scripts`.

**Yarn**: modern Yarn reads `npmMinimalAgeGate: 4d` from `~/.yarnrc.yml`. Yarn 1 ignores this setting, and Corepack can still expose Yarn 1 for legacy projects, so prefer pnpm unless the project pins Yarn 4+.

## Install scripts

**Install scripts disabled (npm/pnpm)**: `ignore-scripts=true` in `~/.npmrc` and `ignoreScripts: true` in `~/.config/pnpm/config.yaml`. Most recent npm RCE campaigns (Shai-Hulud, tinycolor, ngx-bootstrap) use `postinstall` as the execution primitive - disabling scripts neutralises that vector regardless of whether the malicious version slipped through quarantine.

pnpm 11 blocks build scripts by default (`allowBuilds`); the `ignoreScripts` setting is belt-and-braces. Note pnpm 11 also fails *closed*: `strictDepBuilds` defaults to `true`, so unreviewed build scripts error the install (`ERR_PNPM_IGNORED_BUILDS`, non-zero exit) rather than warn - fatal in CI (e.g. Cloudflare Workers Builds) but masked locally by our global `ignoreScripts`. Record per-package decisions in `pnpm-workspace.yaml` `allowBuilds`. npm has no equivalent default, so the rc setting is the meaningful change there.

Native modules and codegen need scripts to build. When a project errors out:

1. **Ask the user before allow-listing.** Security decision is theirs, not the agent's.
2. With approval, allow-list specifically:
   - **pnpm** (v11): `pnpm approve-builds` (interactive) or add to `allowBuilds` in `pnpm-workspace.yaml` (`false` = acknowledged-and-skipped, `true` = runs; pnpm 11 no longer reads `package.json#pnpm`).
   - **npm**: project-level `.npmrc` with `ignore-scripts=false` (no per-package primitive exists).

**Agents: do not disable this globally.** Ask first, then allow-list narrowly. The friction is the security control.

The same block stops husky/hk wiring themselves, since both do it from `prepare`: a repo's declared hooks stay unarmed, silently. That is intended - a clone that armed itself would run repo-authored code on every later commit - so the fix is visibility, not auto-install. `git hooks status` names what a repo declares versus what fires, and `rs` reports it at the end of setup. Arming stays a hand-typed command; the reasoning and the rejected alternatives are in [docs/adr/0005](adr/0005-repo-hooks-are-reported-not-armed.md).

The block suppresses a repo's own `preinstall`/`install`/`postinstall` just as silently, and neither manager has a root-only allow-list - so a `patch-package` step or a codegen step (`wxt prepare`) is skipped with no output at all. Applying the same fix, `rs` names them after the install (`scripts: postinstall - not run (npm ignore-scripts)`, plus the command that would run it), so a dropped patch or missing generated type surfaces at setup rather than days later; it reports and runs nothing.

## Detective layer

**Detective layer (osv-scanner)**: every control above is *preventive* and *time-based* - they slow adoption so the community can flag a bad release, but nothing detects malware that already slipped through (the 2026 worm wave shipped packages with *valid* SLSA provenance). `osv-scanner` (mise: `aqua:google/osv-scanner`) closes that gap: `mise run supply-audit` scans the current project's lockfiles (npm, Cargo, uv, …) against the OSV `MAL-*`/vuln database. Run it in a project dir; wire it into CI for repos that matter. The sweep also runs automatically on every non-frozen `up` via `lockfile-audit` (`mise run lockfile-audit`), which scans every dotfiles-tracked lockfile *before any mutation*: a `MAL-*` advisory (id or alias) aborts the update with the tree still clean, ordinary CVEs print a table but never block (triage separately), and scanner errors/offline only warn - a detective control must not brick updates. `up --no-audit` is the escape hatch. Note osv-scanner cannot parse `mise.lock`/`flake.lock`; the tool bump itself stays covered by the preventive layer (quarantine + attestations + SLSA + aube's bloom check), so this is a re-check of project lockfiles against an ever-growing advisory DB, not a guard on the bump.

## Cargo, Ruby, Composer

**Cargo/Rust**: the one ecosystem without a stable proactive age-gate, and `build.rs` runs arbitrary code at build with no global off-switch (unlike npm's `ignore-scripts`). Native `-Zmin-publish-age` / `registry.global-min-publish-age` is nightly-only as of Cargo 1.96; revisit once [cargo#17009](https://github.com/rust-lang/cargo/issues/17009) stabilises. For now the cover is reactive: `mise run supply-audit` (osv-scanner) flags known-bad `Cargo.lock` entries, with `cargo audit` / `cargo deny` available on demand (no fast prebuilt in the mise registry, so not pinned). Cargo CLIs built from source via Nix ([packages/terminal-control.nix](../.config/nix/packages/terminal-control.nix)) dodge the gap proactively: a pinned+hashed source rev is the checkpoint, so the derivation builds one vetted revision rather than re-resolving crates.io at build time.

**Ruby / Bundler**: system Bundler 1.17.2 has no cooldown support. If Ruby work becomes active, install modern Ruby/Bundler and set `bundle config set --global cooldown 4`.

**Composer**: no package-age quarantine is configured; keep `secure-http=true` and Composer audit enabled. Prefer lockfile review plus `mise run supply-audit` where supported.

## Homebrew

`microsoft-teams` is marked `greedy` (in [darwin-desktop.nix](../.config/nix/modules/darwin-desktop.nix)) because Microsoft AutoUpdate is absent here, so its `auto_updates` cask would otherwise never upgrade ("old version" banner); `homebrew.onActivation.upgrade` makes `drs` own its version.

`cleanup`'s `brew` target runs `brew cleanup --prune=all`, not brew's default 120-day policy: with `homebrew.onActivation.upgrade = true` every `drs`/`up` fetches fresh bottles and casks and leaves the superseded downloads behind, so `brew cleanup -n` reports 0 while gigabytes sit in `$(brew --cache)`. `brew autoremove` is excluded - it uninstalls dependencies, and `cleanup = "zap"` means nix-darwin already owns which packages exist.

The `zap` policy ([darwin-shared.nix](../.config/nix/modules/darwin-shared.nix)) needs macOS **Full Disk Access** to delete a cask's associated files. Without it brew prints `Error: Unable to remove some files` and the rebuild still exits 0, so the undeclared cask's data stays on disk while `up`'s cleanup summary reports the policy as run. The grant is **per terminal binary**, not per user: iTerm, Terminal and a tmux-launched shell each need their owning app granted in System Settings > Privacy & Security > Full Disk Access. `up` reports the missing grant as a degradation on the `rebuild` row.
