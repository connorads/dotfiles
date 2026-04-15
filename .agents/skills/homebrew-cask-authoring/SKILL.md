---
name: homebrew-cask-authoring
description: Create, update, validate, and submit Homebrew Casks. Use when the user mentions Homebrew cask/cask, Homebrew/homebrew-cask, adding a new cask, updating a cask, cask token naming, sha256, url verified:, livecheck, zap/uninstall, or when asked to run brew style/audit for a cask.
---

# Homebrew Cask Authoring

Author and maintain Homebrew Casks with correct token naming, stanzas, audit/style compliance, and local install testing.

## Operating rules

- Prefer the official Homebrew documentation (Cask Cookbook, Acceptable Casks) when uncertain.
- Keep casks minimal: only add stanzas that are required for correct install/uninstall/cleanup.
- Avoid destructive system changes unless explicitly requested; call out any `rm`/tap changes before suggesting them.
- When testing local casks, ensure Homebrew reads from the local file (not the API).

## Quick intake (ask these first)

Collect:
- App name (exact `.app` bundle name)
- Homepage (official)
- Download URL(s) (DMG/ZIP/PKG) and whether they differ by arch
- Version scheme (single version? per-arch?)
- Install artifact type (`app`, `pkg`, `suite`, etc.)
- Uninstall requirements (pkgutil ids, launch agents, kernel extensions)
- Desired cleanup (zap paths)

If any of these are unknown, propose a short plan to discover them.

## Pre-flight checks (before writing the cask)

Before investing effort in a new cask, verify:

1. **Notability**: The app must have meaningful public presence. GitHub projects with <30 forks/watchers or <75 stars are likely to be rejected. **Self-submission threshold is 3× higher** (90 forks / 90 watchers / 225 stars) if the PR author also owns the upstream repo. See [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks).
2. **Repo age**: GitHub repos less than 30 days old cause a hard `brew audit --new` failure. Wait until the repo is old enough.
3. **Previously refused**: Search [closed unmerged PRs](https://github.com/search?q=repo%3AHomebrew%2Fhomebrew-cask+is%3Aclosed+is%3Aunmerged+&type=pullrequests) for the token. If previously rejected for unfixable reasons, do not re-submit.
4. **Existing PRs**: Check [open PRs](https://github.com/Homebrew/homebrew-cask/pulls) to avoid duplicating work.
5. **Modern macOS compatibility**: Casks that don't work on current macOS will be rejected outright. Avoid submitting x86-only / `requires_rosetta` new casks — they're on a deprecation path (blocked once macOS 27 is stable, removed after 28).

## Workflow: create or update a cask

### 1) Choose the token

- Start from the `.app` bundle name.
- Remove `.app` and common suffixes: "App", "for macOS", version numbers.
- Remove "Mac" unless it distinguishes the product (e.g., "WinZip Mac" vs "WinZip").
- Remove "Desktop" only when it's a generic suffix, **not** when it's intrinsic to the product name. Keep it for products branded as "X Desktop" (e.g., `Docker Desktop` → `docker-desktop`, `LTX Desktop` → `ltx-desktop`). When in doubt, keep "Desktop".
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
  - Primary tool: **`brew generate-zap <token>`** (documented Mar 2026). Install and launch the app first, then run it to get a draft zap stanza. Still review the output — it can include noise.
  - **Also scan while the app is in *active use*, not just after first launch.** Paths like `~/Library/HTTPStorages/<bundle-id>`, session caches, and some preferences only appear after login/real interaction. `generate-zap` may miss these if you only ran the app once.
  - Keep Keystone/GoogleUpdater-style shared components in `zap` only (never `uninstall`) — they're shared across vendor apps.
- **`livecheck`**: `strategy :extract_plist` and `version :latest` are *automatically* excluded from autobump — no `no_autobump!` needed.
- **`depends_on`**: Optional. Only add when genuinely needed (e.g., specific macOS version, another cask dependency).

### 5) Validate and test locally

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

If install fails:
- Re-check URL reachability, `sha256`, and artifact name.
- Re-run with verbosity: `brew install --cask --verbose <token>`.

### 6) PR hygiene

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

### 7) AI disclosure

The PR template includes an AI disclosure section. If AI assisted with the PR:
- Check the AI checkbox in the template.
- Split the disclosure into two parts: **what the agent ran** (list the `brew` commands executed and note the human read the output) and **what the human verified manually** (app install, login, actual usage, zap path derivation, running-app uninstall). Reviewers value seeing both halves.
- Call out any non-obvious things the agent's testing surfaced (e.g. a helper process needing a second bundle ID in `uninstall quit:`).

## Local development patterns

If the user is editing `Homebrew/homebrew-cask` locally and wants Homebrew to execute their working copy, use a tap symlink workflow.

Read the full end-to-end checklist here:
- `references/homebrew-cask-contribution-workflow.md`
