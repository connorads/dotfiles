---
name: homebrew-cask-authoring
description: Create, update, validate, and submit Homebrew Casks (macOS and Linux/AppImage). Use when the user mentions Homebrew cask/cask, Homebrew/homebrew-cask, adding a new cask, updating or bumping a cask, cask token naming, generate-cask-token, sha256, livecheck, zap/uninstall, AppImage/app_image, on_linux/on_macos, cross-platform cask, or when asked to run brew style, brew audit or brew lgtm for a cask.
---

# Homebrew Cask Authoring

> Would a homebrew-cask maintainer merge this without asking a question?

Homebrew's cops and audits enforce layout, ordering and most syntax. This skill
covers what they can't: eligibility, naming, cleanup paths, testing and PR
conduct. When a rule here and `brew style`/`brew audit` disagree, the tool wins -
it tracks Homebrew's current release, this file doesn't.

## Operating rules

- Fetch homebrew-cask's own agent policy before a PR and follow it:
  `gh api repos/Homebrew/homebrew-cask/contents/AGENTS.md -H 'Accept: application/vnd.github.raw'`.
  Official docs: [Cask Cookbook](https://docs.brew.sh/Cask-Cookbook),
  [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks).
- Keep casks minimal: only stanzas required for correct install, uninstall and cleanup.
- Never write `url ..., verified:`. It is deprecated and ignored; drop it from any cask you edit.
- A cask supporting one OS needs a top-level `depends_on :macos` (or a versioned
  `depends_on macos: :<sym>`) or `depends_on :linux`. Artifact type no longer implies the OS.
- A cross-platform cask has no top-level OS dependency. Gate OS-specific artifacts
  inside `on_macos` (`app`, `pkg`, `suite`, ...) or `on_linux` (`app_image`); `binary` is
  portable. Put `depends_on macos:` inside `on_macos` - at top level it drops Linux.
- Call out any `rm`, tap or system change before running it. Restore standard
  Homebrew state after testing unless the user asks to keep the override.

## Pre-flight (new casks)

1. **Notability** ([policy](https://docs.brew.sh/Package-Acceptance-Policy#notability)):
   GitHub projects under 30 forks/watchers or 75 stars are likely rejected; 3x
   (90/90/225) when the PR author owns the upstream repo. Linux-only and
   AppImage casks get no exemption.
2. **Age**: the repo *and* the homepage domain must be at least 30 days old, or
   `brew audit --new` fails regardless of cask quality.
3. **Gatekeeper**: macOS artifacts must be signed and notarised
   (`spctl -a -vv <App>.app`). Unsigned apps are ineligible; never suggest
   `--no-quarantine` or disabling Gatekeeper as a workaround.
4. **Rosetta**: new `requires_rosetta` / x86_64-only macOS casks become
   ineligible once macOS 27 is the latest stable macOS. Check before drafting one.
   Linux-only casks are exempt.
5. **Right repo**: an open-source CLI with no compiled app belongs in
   homebrew/core. A homebrew/core rejection does not make it eligible as a cask.
6. **Prior art**: search [closed unmerged PRs](https://github.com/search?q=repo%3AHomebrew%2Fhomebrew-cask+is%3Aclosed+is%3Aunmerged+&type=pullrequests)
   and [open PRs](https://github.com/Homebrew/homebrew-cask/pulls) for the token.
   Don't resubmit a refusal for an unfixable reason.
7. **Linux build**: check whether upstream ships an AppImage. Reviewers ask for
   it on new casks, so include it when it exists.
8. **Pre-releases**: if upstream marks every GitHub release pre-release, the
   online audit fails with `<tag> is a GitHub pre-release`. Add
   `"<token>": "all"` to `audit_exceptions/github_prerelease_allowlist.json`
   in the same commit (precedent: `agent-tars`, `duplicati`); `"all"` also errors
   if a non-pre-release appears later. Insert beside its neighbours - the file is
   not strictly sorted, so re-sorting it is a drive-by diff. Justify it in the PR body.

## Workflow

### 1) Token

Start from `brew generate-cask-token "<App Name>.app"`, then apply the judgement
rules it doesn't:

- Remove "Mac" unless the app is not a port and "Mac" is inseparable from the name (`playonmac`).
- Drop "Desktop" by default. A maintainer accepted `executor` for a desktop app,
  with a later homebrew/core CLI taking `executor-cli`. The bare name goes to
  whichever component lands in Homebrew first.
- Keep "Desktop" only when it is the brand (`docker-desktop`, `ltx-desktop`) or a
  sibling already exists *in Homebrew* under the bare name. A CLI that exists
  only upstream (npm, crates.io) is not a reason.
- The `cask token mentions desktop` audit is strict-only (fires under `--new`).
  Justify the choice in the PR body either way.
- Variants: `@beta`, `@nightly`, `@latest`, `@<major>`.

Confirm the token with the user before writing the file.

### 2) Draft

Scaffold with `brew create --cask <url> --set-name <token>`, then trim to:

```ruby
cask "token" do
  version "1.2.3"
  sha256 "..."

  url "https://example.com/app-#{version}.dmg"
  name "Official App Name"
  desc "Short one-line description"
  homepage "https://example.com/"

  depends_on :macos

  app "AppName.app"
end
```

- `desc`: factual, no marketing, no platform words ("for macOS"), under 80 chars.
- Swap `depends_on :macos` for `depends_on macos: :<sym>` when the app needs a
  newer floor. `brew audit --cask --online --fix <token>` derives it from the
  bundle, but only for casks with no `on_*` blocks. Symbol table: the reference.

### 3) Architecture

Check the binary, not vendor marketing:

```bash
lipo -archs "/Volumes/<Vol>/<AppName>.app/Contents/MacOS/<AppName>"
```

- `arm64` only: add `depends_on arch: :arm64`, or Intel users install an app they can't run.
- Universal: no arch gate.
- Per-CPU downloads, same version: `arch arm: ..., intel: ...` plus `sha256 arm: ..., intel: ...`.
- Per-CPU versions: `on_arm` / `on_intel` blocks.

### 4) uninstall and zap

- `uninstall` is required for `pkg` and `installer` (`pkgutil:`, `launchctl:`, ...).
- `uninstall quit:` runs on uninstall, upgrade and reinstall; Homebrew reopens the
  app after an upgrade. `signal:` is skipped on upgrade unless `on_upgrade: :signal`.
- An app can ignore `quit:` when a modal window (a first-run permissions panel)
  blocks its run loop. CI's zap-check launches the app on a fresh runner, so it
  hits this where a granted local install does not; CI then fails with "Some
  launch jobs were not unloaded". `signal:` does not help on macOS 26: Homebrew
  finds processes by launchd label, and the label now ends in a UUID
  (`application.<id>.<n>.<n>.<UUID>`) that its pattern rejects. Use
  `launchctl: "application.<bundle-id>.*"` beside `quit:` (precedent:
  `shutter-encoder`, `cmux`); removing the job ends the process.
- `launchctl:` checks each job again with `sudo`, so a local uninstall prompts
  for a password even for a user-level job. The non-sudo pass has already
  removed it; cancelling the prompt is safe. CI's sudo is passwordless.
- An app with helper processes (`Contents/Helpers/`, or `pgrep -lf <AppName>` while
  running) needs every bundle ID in `quit:`. A wildcard works if the ID keeps at
  least 3 dot-separated parts (`"com.vendor.*"`).
- `zap` is optional for audit but expected by reviewers for new casks:
  1. Install, launch and *use* the app (log in, real work) - some paths
     (`~/Library/HTTPStorages/<id>`, session caches) only appear after use.
  2. Run `brew generate-zap <token>` (or `--name "<App Name>"` before the cask
     exists). If it errors asking for Full Disk Access, grant it to the terminal
     and rerun. Review the output; it includes noise.
  3. `generate-zap` covers `~/Library` and `~/.<app>` dotfolders, not XDG paths.
     If state survives `--zap` + reinstall, grep upstream source for
     `os.homedir()`, `env-paths`, `xdg`.
     It also matches only the app name, so it reports "No zap stanza required"
     when state is named after the CLI or token (`~/Library/Caches/<cli>`). Search
     `~/Library` for the token and bundle ID too, and grep upstream source for
     path joins; some directories only appear once a feature is used.
  4. After opening the PR, read CI's zap-check job summary for paths it thinks
     are missing.
- Keystone/GoogleUpdater-style shared components go in `zap` only, never `uninstall`.

### 5) livecheck

- Omit `livecheck` when the default check finds the version. Add a block only for
  a demonstrated need (pre-releases, releases without assets, wrong source).
- For a Sparkle app, find its feed with `brew find-appcast <path>.app`.
- `:github_latest` / `:github_releases` are opt-in only; use them when Git tags or
  an upstream feed won't work. They match `tag_name`, not asset names.
- `strategy :extract_plist` and `version :latest` are excluded from autobump
  automatically; no `no_autobump!` needed.

### 6) Cross-platform (macOS + Linux AppImage)

- Per-OS strings live in top-level `arch` (`intel: on_system_conditional(macos: "x64", linux: "x86_64")`),
  `os`, or an `on_system_conditional` local - all before `version`.
- One top-level `sha256` keyed `arm:`, `intel:`, `arm64_linux:`, `x86_64_linux:`
  (only the keys that exist). Never nest `sha256` in `on_macos`/`on_linux`.
- `on_macos` / `on_linux` blocks go after `sha256`, before `url`.
- `app_image "<file>", target: "<App>.AppImage"` - the target must not contain a version.

Templates (four-arch, single-arch Linux, universal macOS), the `depends_on macos:`
symbol table and `app_image` behaviour are in
[references/homebrew-cask-contribution-workflow.md](references/homebrew-cask-contribution-workflow.md).

### 7) Validate

Run from a local homebrew/cask checkout (setup: the reference):

```bash
brew style --fix <token>
brew audit --cask --online --os=all --arch=all <token>
brew audit --cask --new <token>                          # new casks; implies --strict --online
brew lgtm --online                                       # final gate; stage the cask first
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
brew uninstall --cask <token>
```

- `brew audit` is silent on success.
- `brew lgtm` diffs against the local `main` branch, not `origin/main`. In a
  stale checkout it audits every cask upstream changed since (downloading their
  artifacts). First `git fetch origin && git rebase origin/main`, then
  `git branch -f main origin/main`; `git diff --name-only main` should list only your files.
- Plain `--online` audits only the host OS/arch; `--os=all --arch=all` covers `on_linux` from a Mac.
- Install and uninstall by token, never by file path.
- On a TTY (tmux, agent PTY), `brew install` asks for confirmation when it pulls
  dependencies; pass `-y`.

Validate zap with the app running:

```bash
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
open "/Applications/<AppName>.app"     # log in, use it
brew uninstall --zap --cask <token>
pgrep -lf <AppName>                    # empty, or add bundle IDs to uninstall quit:
```

Reinstall after plain `uninstall` should keep the login; after `--zap` it should
not. That confirms zap targets the real user state.

`uninstall --zap` uses the stanzas recorded at install time
(`Caskroom/<token>/.metadata/`), not your working copy. After editing `zap`:
uninstall, install, then `uninstall --zap`.

### 8) PR

- Version bump of an existing cask: `brew bump --open-pr <token>` (or
  `brew bump-cask-pr <token> --version <new>`). The manual flow is for new casks
  and stanza changes.
- One cask per PR, minimal diff, no drive-by formatting. Base branch `main`.
- Commit subject (<=50 chars): `token 1.2.3 (new cask)`, `token 1.2.3`, or `token: description`.
- One commit per cask when opening. After opening, push review and CI fixes as
  new commits (homebrew-cask `AGENTS.md`). Squash only when a maintainer asks;
  CONTRIBUTING.md and the docs describe squashing, so expect that request.
- PR body: keep the template. Add one prose sentence above the checklist ("Adds a
  cask for [App](https://...), a ..."), not a bare URL. Tick only what was done.
  No verbose logs or AI analysis.

### 9) AI disclosure

Follow [Responsible AI Usage](https://docs.brew.sh/Responsible-AI-Usage) and the template:

- The human ticks the AI checkbox only after reviewing the output, including `zap` paths.
- Below it, briefly: the tool/model, how it was used, and what the human verified
  by hand (install, login, use, zap derivation, running-app uninstall). Mention
  anything non-obvious testing surfaced, such as a helper needing a second `quit:` ID.
- No `Co-Authored-By`, `Assisted-by` or similar AI trailers on commits.
- The human answers maintainer questions and review comments without AI. The
  agent does not draft or post them.
- Non-maintainers may have only one AI-assisted PR open at a time.
