---
name: homebrew-cask-authoring
description: Create, update, validate, and submit Homebrew Casks (macOS and Linux/AppImage). Use when the user mentions Homebrew cask/cask, Homebrew/homebrew-cask, adding a new cask, updating a cask, cask token naming, sha256, url verified:, livecheck, zap/uninstall, AppImage/app_image, on_linux/on_macos, cross-platform cask, or when asked to run brew style/audit for a cask.
---

# Homebrew Cask Authoring

Author and maintain Homebrew Casks with correct token naming, stanzas, audit/style compliance, and local install testing.

## Operating rules

- Prefer the official Homebrew documentation (Cask Cookbook, Acceptable Casks) when uncertain.
- Keep casks minimal: only add stanzas that are required for correct install/uninstall/cleanup.
- Avoid destructive system changes unless explicitly requested; call out any `rm`/tap changes before suggesting them.
- When testing local casks, ensure Homebrew reads from the local file (not the API).
- Treat local Homebrew tap overrides as temporary. When done testing/submitting, restore standard Homebrew state unless the user asks to keep the override.
- **`app_image` is a Linux-only artifact**: a macOS install raises `This cask requires Linux.` unless every `app_image` stanza is gated inside an `on_linux do ... end` block. Conversely, `app`, `pkg`, `suite`, `qlplugin`, `prefpane`, `vst_plugin`, etc. are macOS-only and must be gated inside `on_macos`. (Top-level `depends_on :linux` is for a *Linux-only* cask only — it deliberately makes the cask refuse to install on macOS, so don't reach for it to gate a cross-platform cask.)

## Quick intake (ask these first)

Collect:
- App name (exact `.app` bundle name on macOS; for Linux, the AppImage filename)
- Homepage (official)
- Download URL(s) (DMG/ZIP/PKG on macOS; `.AppImage` / `.tar.gz` on Linux) and whether they differ by arch
- Version scheme (single version? per-arch? per-OS?)
- Install artifact type (`app`, `pkg`, `suite`, `app_image`, `binary`, etc.)
- Platforms supported: macOS only, Linux only, or both (cross-platform)
- Uninstall requirements (pkgutil ids, launch agents, kernel extensions)
- Desired cleanup (zap paths)

If any of these are unknown, propose a short plan to discover them.

## Pre-flight checks (before writing the cask)

Before investing effort in a new cask, verify:

1. **Notability**: The app must have meaningful public presence. GitHub projects with <30 forks/watchers or <75 stars are likely to be rejected. **Self-submission threshold is 3× higher** (90 forks / 90 watchers / 225 stars) if the PR author also owns the upstream repo. See [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks).
2. **Repo age**: GitHub repos less than 30 days old cause a hard `brew audit --new` failure. Wait until the repo is old enough.
3. **Previously refused**: Search [closed unmerged PRs](https://github.com/search?q=repo%3AHomebrew%2Fhomebrew-cask+is%3Aclosed+is%3Aunmerged+&type=pullrequests) for the token. If previously rejected for unfixable reasons, do not re-submit.
4. **Existing PRs**: Check [open PRs](https://github.com/Homebrew/homebrew-cask/pulls) to avoid duplicating work.
5. **Modern macOS compatibility**: Casks that don't work on current macOS will be rejected outright. Avoid submitting x86-only / `requires_rosetta` new casks — they're on a deprecation path (blocked once macOS 27 is stable, removed after 28). This only governs the macOS side of a cross-platform cask — a Linux-only cask (or one with `depends_on :linux`) is exempt.
6. **Linux/AppImage notability**: [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks) doesn't carve out a Linux exception, so hold Linux-only and cross-platform casks to the same notability bar as macOS casks (1). AppImage distribution alone is not sufficient; the upstream project still needs the public presence described in (1).

## Workflow: create or update a cask

### 1) Choose the token

- Start from the `.app` bundle name.
- Remove `.app` and common suffixes: "App", "for macOS", version numbers.
- Remove "Mac" unless it distinguishes the product (e.g., "WinZip Mac" vs "WinZip").
- Drop "Desktop" by default — reviewers want the bare name. Maintainer guidance: "It should be ok to use `executor` for the token here, if the CLI is added to `homebrew-core` later it can use `executor-cli`." The bare name goes to whichever component lands in Homebrew first; subsequent siblings disambiguate (`-cli`, `-cloud`, etc.).
- Only keep "Desktop" when:
  - It's part of the actual product brand (e.g., `Docker Desktop` → `docker-desktop`, `LTX Desktop` → `ltx-desktop`), **or**
  - An upstream sibling component (CLI, cloud variant) already exists *in Homebrew* (formula or cask) under the bare name.
- A bare-named CLI that exists only upstream (npm, crates.io, etc.) and isn't yet packaged for Homebrew is **not** a reason to keep "Desktop" — submit the cask under the bare name and let the CLI take a suffix if/when it's added.
- The `cask token mentions desktop` audit cop is `strict_only` (fires under `--new`); reviewers accept the suffix when justified by the rules above. Existing `-desktop` casks (`aks-desktop`, `grammarly-desktop`, `firefly-iota-desktop`) don't validate the suffix as a generic pattern — check why each was named that way before citing them. Justify the choice in the PR description either way.
- Downcase; replace spaces/underscores with hyphens.
- Remove non-alphanumerics except hyphens.
- Use `@beta`, `@nightly`, or `@<major>` for variants.

Confirm the token before writing the file.

### 2) Draft a minimal cask

Use this canonical structure:

```ruby
cask "token" do
  version "1.2.3"
  sha256 "..."

  url "https://example.com/app-#{version}.dmg"
  name "Official App Name"
  desc "Short one-line description"
  homepage "https://example.com"

  app "AppName.app"
end
```

Rules of thumb:
- Prefer `https` URLs.
- Add `verified:` when download host domain differs from `homepage` domain.
- Keep `desc` factual and concise (no marketing).

### 3) Handle architecture (if needed)

Always confirm the binary's architectures — don't assume from vendor marketing. Mount the DMG (or unpack the artifact) and run:

```bash
lipo -archs "/Volumes/<Vol>/<AppName>.app/Contents/MacOS/<AppName>"
```

Then:
- **Single-arch (`arm64` only)**: add `depends_on arch: :arm64` alongside any `macos:` gate. Without it, Intel users on a supported macOS can install a cask they can't run — a user-facing install-time regression reviewers will flag.
- **Universal (`arm64 x86_64`)**: no arch gate needed.
- **Different URLs and/or sha256 per CPU**: use `arch` + `sha256 arm: ..., intel: ...` when versions match.
- **Different versions per CPU**: use `on_arm` / `on_intel` blocks.

### 4) Add uninstall/zap stanzas

- **`uninstall`**: Required for `pkg` and `installer` artifacts. Include `pkgutil:` identifiers, launch agents, etc.
  - For `.app` casks, `uninstall quit:` is still useful so `brew uninstall` cleanly terminates a running app. If the app bundles helper processes (look in `Contents/Helpers/` or run `pgrep -lf <AppName>` while it's running), pass an array of bundle IDs (e.g. main app + `*.launcher`) — a single ID leaves helpers stranded.
  - **`quit:` / `signal:` no longer run during `brew upgrade`/`brew reinstall` by default** (Nov 2025 change). If you need the app to be quit during upgrade, add `on_upgrade: :quit` (or `on_upgrade: [:quit, :signal]`).
- **`zap`**: Recommended for thorough cleanup (support dirs, preferences, caches) but not enforced by `brew audit`. Reviewers expect it for new casks — verify paths are accurate.
  - Primary tool: **`brew generate-zap <token>`** (documented Mar 2026). Install and launch the app first, then run it to get a draft zap stanza. Still review the output — it can include noise. If it aborts after only printing the "Scanning" line, it likely hit a TCC permission error (e.g. `Operation not permitted @ dir_initialize - .../sharedfilelist/...`); exit code can still look fine. Fall back to `find ~/Library -name "*<bundle-id>*"` plus a manual sweep of the standard Electron locations (`Application Support`, `Caches`, `HTTPStorages`, `Logs`, `Preferences`, `Saved Application State`).
  - **Also scan while the app is in *active use*, not just after first launch.** Paths like `~/Library/HTTPStorages/<bundle-id>`, session caches, and some preferences only appear after login/real interaction. `generate-zap` may miss these if you only ran the app once.
  - **If state still survives `--zap` + reinstall, scan outside `~/Library/`.** Apps that bundle a Node CLI/server (`Contents/Resources/sidecar/`) often persist to dotfolders (`~/.<appname>`) and XDG paths (`~/.local/share/<appname>`) — `generate-zap` and bundle-ID scans don't cover these. Cloning the upstream repo and grepping for `os.homedir()` / `env-paths` will surface them.
  - Keep Keystone/GoogleUpdater-style shared components in `zap` only (never `uninstall`) — they're shared across vendor apps.
- **`livecheck`**: `strategy :extract_plist` and `version :latest` are *automatically* excluded from autobump — no `no_autobump!` needed.
- **`depends_on`**: Optional. Only add when genuinely needed (e.g., specific macOS version, another cask dependency).

### 5) Cross-platform casks: macOS + Linux (AppImage)

A cask can target both OSes: shared top-level stanzas, then sibling `on_macos do ... end` / `on_linux do ... end` blocks for platform-specific artifacts.

**Structural rules:**
- `on_macos`/`on_linux` are **sibling blocks at the top level** — never nest one inside the other.
- `app_image` is **Linux-only** — gate inside `on_linux`; macOS-only artifacts (`app`, `pkg`, `suite`, ...) go inside `on_macos`. An ungated artifact makes the cask refuse the other OS (`This cask requires Linux./macOS.`). Top-level `depends_on :linux` is for a *Linux-only* cask only — it intentionally blocks macOS install.
- `arch` must appear **before** `url` if `url` interpolates `#{arch}`. When `arch` values differ per platform, define inside both `on_macos`/`on_linux` blocks at the top of the file.
- `sha256`: **when all four arches build exist (macOS arm + intel, Linux arm64 + x86_64), put them in a single top-level `sha256` block — this is maintainer-preferred, not split per-OS.** Split into separate `sha256` inside each `on_*` block only when one OS's sha is unkeyed (single-arch) or the key set genuinely differs.
- Common stanzas (`version`, `url`, `name`, `desc`, `homepage`) at top level. Switch download extension with `url_end = on_system_conditional linux: ".AppImage", macos: ".dmg"`.
- **`zap` goes inside `on_macos` only.** For AppImage casks the `on_linux` block conventionally has **no `zap` stanza**. Runtime user state (`~/.config/<appid>`, `~/.cache/<appid>`, `~/.local/share/<appid>`, `~/.<appname>`) is created by the app at runtime, not at install time, so there's nothing for `zap` to reverse on the install side.
- `brew style` has no stanza-order position for `app_image`, so place it alone inside `on_linux` and run `--fix` anyway.

Canonical structure (different `arch` per platform):

```ruby
cask "token" do
  version "1.2.3"

  sha256 arm:          "...",
         intel:        "...",
         arm64_linux:  "...",
         x86_64_linux: "..."

  on_macos do
    arch arm: "aarch64", intel: "x64"
  end

  on_linux do
    arch arm: "aarch64", intel: "amd64"
  end

  url_end = on_system_conditional macos: ".dmg", linux: ".AppImage"

  url "https://example.com/download/v#{version}/App_#{version}_#{arch}#{url_end}",
      verified: "example.com/"
  name "App Name"
  desc "Short description"
  homepage "https://example.com"

  on_macos do
    auto_updates true
    depends_on macos: :big_sur

    app "App.app"

    zap trash: [
      "~/Library/Application Support/com.example.app",
      "~/Library/Preferences/com.example.app.plist",
    ]
  end

  on_linux do
    app_image "App_#{version}_#{arch}.AppImage", target: "App.AppImage"
  end
end
```

- **Single-arch Linux AppImage**: when the Linux build ships for only one arch (e.g. x86_64 only), put a plain (unkeyed) `sha256 "<hex>"` *inside* `on_linux` and add `depends_on arch: :x86_64` there too — do not use the `x86_64_linux:`/`arm64_linux:` keys, and do not put `depends_on arch:` at top level (it would block macOS). Model on `t3-code` in `homebrew-cask`: macOS side uses `sha256 arm: ..., intel: ...` with `arch` switching the `.dmg`, while `on_linux` uses a plain `sha256` + `depends_on arch: :x86_64` + a fixed `app_image` filename via `on_system_conditional`.

Model on `dbx`, `beekeeper-studio`, `bdash` (AppImage on Linux) from krehel's PRs; also `agentsview`, `zen`, `zettlr`, `tabby`. Full worked example and `app_image` internals: `references/homebrew-cask-contribution-workflow.md`.

### 6) Validate and test locally

Run, in this order:

```bash
brew style --fix <token>
brew audit --cask --online <token>
```

For new casks also run:

```bash
brew audit --cask --new <token>
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
brew uninstall --cask <token>
```

Then validate the full `zap` path with the app *running*:

```bash
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
open /Applications/<AppName>.app   # log in, use it
HOMEBREW_NO_INSTALL_FROM_API=1 brew uninstall --zap --cask <token>
pgrep -lf <AppName>                # should be empty — if not, add bundle IDs to `uninstall quit:`
```

Reinstalling after a plain `brew uninstall` (without `--zap`) should leave session data intact (so login persists). Reinstalling after `--zap` should require a fresh login. Verifying both confirms the zap paths are actually the ones that hold user state.

**Important notes:**
- Always install/uninstall by **token name**, not file path. Running `brew install ./Casks/t/token.rb` will fail when using a tap symlink — use `brew install --cask token` instead.
- `HOMEBREW_NO_INSTALL_FROM_API=1` forces Homebrew to use your local cask file rather than the API.
- `brew audit --cask --new` checks GitHub repo age (must be >30 days) and notability — if the repo is too new, this will fail regardless of cask quality.
- `brew audit` prints nothing on success (silent = pass) — don't mistake empty output for the command failing to run.
- **When iterating on the `zap` stanza, reinstall before re-zapping.** `brew uninstall --zap` reads the cached cask from `/opt/homebrew/Caskroom/<token>/.metadata/<version>/...`, not your working copy. After editing zap paths: `brew uninstall` → `brew install` (refreshes the cached metadata) → `brew uninstall --zap`. The `==> Trashing files:` log will silently use the previous stanza otherwise.
- **Cross-platform casks**: `brew audit --cask --online` validates both the `on_macos` and `on_linux` sides from either OS — run it even if you can only install-test one. On Linux the AppImage lands in `~/Applications/<target>`; `brew uninstall --zap --cask <token>` removes it (confirm with `ls -l ~/Applications/<target>`).

If install fails:
- Re-check URL reachability, `sha256`, and artifact name.
- Re-run with verbosity: `brew install --cask --verbose <token>`.

### 7) PR hygiene

Before suggesting submission:
- Ensure `brew style` and all relevant `brew audit` commands pass.
- For new casks, check the token has not been previously refused/unmerged.
- One cask change per PR, minimal diffs, no drive-by formatting.
- Target the `main` branch (not `master`).

Commit message format (first line <=50 chars):
- New cask: `token version (new cask)`
- Version update: `token version`
- Fix/change: `token: description`

**PR body**: keep the default template, then replace the placeholder opener with a short prose sentence (hint: a bare URL as the first line may trigger the `request-info` bot — a full sentence like "Adds a new cask for [App Name](https://...) - short description." is safer). Keep all checklist items; tick only what was actually done.

### 8) AI disclosure

The PR template includes an AI disclosure section. If AI assisted with the PR:
- Check the AI checkbox in the template.
- Split the disclosure into two parts: **what the agent ran** (list the `brew` commands executed and note the human read the output) and **what the human verified manually** (app install, login, actual usage, zap path derivation, running-app uninstall). Reviewers value seeing both halves.
- Call out any non-obvious things the agent's testing surfaced (e.g. a helper process needing a second bundle ID in `uninstall quit:`).

## Local development patterns

If the user is editing `Homebrew/homebrew-cask` locally and wants Homebrew to execute their working copy, use a tap symlink workflow.

Before changing the tap, print the current Homebrew state/commands so the restore path is visible in-context.

When the task is done (typically after local validation, commit, or PR creation), restore standard Homebrew state unless the user asks to keep the local override. Prompt before leaving Homebrew in a non-standard state.

Read the full end-to-end checklist here:
- `references/homebrew-cask-contribution-workflow.md`
