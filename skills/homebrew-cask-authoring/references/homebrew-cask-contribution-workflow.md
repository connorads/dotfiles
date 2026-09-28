# Homebrew Cask Contribution Workflow

## Contents

- Local checkout setup and restore
- Cross-platform templates
  - Four-arch (macOS arm/intel + Linux arm64/x86_64)
  - Single-arch Linux AppImage
  - Universal macOS build + Linux
- `depends_on macos:`
- `app_image` behaviour
- Troubleshooting
- Quick reference

SKILL.md owns the rules; this file holds the shapes and procedures they point to.

## Local checkout setup and restore

Homebrew installs casks from its JSON API by default, so there is no local
homebrew/cask tap until you create one. Print `brew tap` output first so the
starting state is visible.

```bash
brew tap --force homebrew/cask
cd "$(brew --repository homebrew/cask)"
git remote add fork https://github.com/<you>/homebrew-cask.git
git switch -c <token>
```

Keep `origin` pointing at `Homebrew/homebrew-cask` - Homebrew trusts the tap
through that remote. Push to `fork` and open the PR from there.

Restore when done (after the PR is open, unless the user wants to keep it):

```bash
git switch main
brew untap homebrew/cask     # back to API-only; skip if the user wants the checkout
```

Plain `brew tap homebrew/cask` refuses in API mode; always pass `--force`.

Symlinking an existing clone into `$(brew --repository)/Library/Taps/homebrew/homebrew-cask`
also works. If that clone's `origin` is your fork, Homebrew may not trust it. Prefer
the `--force` checkout above.

## Cross-platform templates

Copy the shape, then run `brew style --fix` and
`brew audit --cask --online --os=all --arch=all`. Always match the real upstream
asset names rather than guessing arch or OS strings.

### Four-arch (macOS arm/intel + Linux arm64/x86_64)

Modelled on `bruno` and `agentsview`:

```ruby
cask "app-name" do
  arch arm: "arm64", intel: on_system_conditional(macos: "x64", linux: "x86_64")
  os macos: "mac", linux: "linux"
  url_end = on_system_conditional macos: "dmg", linux: "AppImage"

  version "1.2.3"
  sha256 arm:          "...",
         intel:        "...",
         arm64_linux:  "...",
         x86_64_linux: "..."

  on_macos do
    auto_updates true
    depends_on macos: :monterey

    app "AppName.app"

    zap trash: [
      "~/Library/Application Support/AppName",
      "~/Library/Preferences/com.example.app.plist",
    ]
  end
  on_linux do
    app_image "app_#{version}_#{arch}_linux.AppImage", target: "AppName.AppImage"
  end

  url "https://github.com/owner/repo/releases/download/v#{version}/app_#{version}_#{arch}_#{os}.#{url_end}"
  name "App Name"
  desc "Short one-line description"
  homepage "https://example.com/"
end
```

- Wrap `arm:` in `on_system_conditional` too if the arm strings differ per OS
  (`agentsview`: `aarch64` everywhere, `x64`/`amd64` for Intel).
- `os` holds any per-OS URL fragment - an OS name, or the extension itself
  (`t3-code`: `os macos: "dmg", linux: "AppImage"`).
- Conditional keys go `macos:` before `linux:` and `arm:` before `intel:`; `brew style` enforces it.
- `depends_on macos:` stays inside `on_macos`. Omit it when the minimum is Big Sur or lower.
- Write the `app_image` source filename in full; don't reuse a filename variable.

### Single-arch Linux AppImage

Modelled on `t3-code` (Linux x86_64 only). Keep one top-level `sha256` with only
the keys that exist, and gate the Linux arch inside `on_linux`:

```ruby
cask "app-name" do
  arch arm: "arm64", intel: on_system_conditional(macos: "x64", linux: "x86_64")
  os macos: "dmg", linux: "AppImage"

  version "1.2.3"
  sha256 arm:          "...",
         intel:        "...",
         x86_64_linux: "..."

  on_macos do
    depends_on macos: :ventura

    app "AppName.app"

    zap trash: "~/Library/Application Support/AppName"
  end
  on_linux do
    depends_on arch: :x86_64

    app_image "AppName-#{version}-#{arch}.AppImage", target: "AppName.AppImage"
  end

  url "https://github.com/owner/repo/releases/download/v#{version}/AppName-#{version}-#{arch}.#{os}"
  name "App Name"
  desc "Short one-line description"
  homepage "https://example.com/"
end
```

A top-level `depends_on arch: :x86_64` would also block Apple Silicon Macs; keep it in `on_linux`.

### Universal macOS build + Linux

One macOS artifact serves both CPUs. Repeat its sha under `arm:` and `intel:`, and
key only the macOS URL off `os`:

```ruby
  arch arm: "aarch64", intel: "x86_64"
  url_end = on_system_conditional macos: "universal.dmg", linux: "#{arch}.AppImage"

  version "1.2.3"
  sha256 arm:          "<mac sha>",
         intel:        "<mac sha>",
         arm64_linux:  "...",
         x86_64_linux: "..."
```

## `depends_on macos:`

The keyword form is a minimum (`>=`). Read the bundle's floor (casks with no
`on_*` blocks can let `brew audit --cask --online --fix <token>` set it):

```bash
defaults read "/Applications/<AppName>.app/Contents/Info.plist" LSMinimumSystemVersion
```

| `LSMinimumSystemVersion` | Symbol |
| --- | --- |
| 11 | `:big_sur` (Homebrew's floor - use bare `depends_on :macos`, or omit inside `on_macos`) |
| 12 | `:monterey` |
| 13 | `:ventura` |
| 14 | `:sonoma` |
| 15 | `:sequoia` |
| 26 | `:tahoe` |
| 27 | `:golden_gate` |

- `:catalina` and older are disabled and error. A floor at or below 11 adds
  nothing; don't invent one.
- Upper bound: `depends_on maximum_macos: :<sym>`. String comparators
  (`">= :monterey"`) are deprecated.
- Never combine bare `depends_on :macos` with a versioned `macos:`, and never put
  bare `depends_on :macos` inside `on_macos`.

## `app_image` behaviour

- Linux-only artifact. In a cross-platform cask it goes inside `on_linux`; in a
  Linux-only cask, pair it with top-level `depends_on :linux`.
- Install moves the AppImage to `appimagedir/<target>` (default `~/Applications`)
  and makes it executable, like `app` does for bundles. Uninstall removes it, so no
  `uninstall` stanza is needed. Don't hardcode that path in `zap`.
- `target:` defaults to the source basename. Pass a version-free
  `target: "<App>.AppImage"` whenever the source name embeds a version - the audit
  errors on an `X.Y.Z` target.
- `auto_updates true` usually lives in `on_macos` beside the self-updating `.app`.
  Top level is accepted when the Linux build also self-updates.
- Linux `zap` is optional. Add `zap trash:` inside `on_linux` only for XDG paths
  (`~/.config/<app>`, `~/.cache/<app>`, `~/.local/share/<app>`, `~/.<app>`) you
  confirmed in upstream source. `generate-zap` does not scan XDG paths.

## Troubleshooting

- **"Cask not found" / wrong version installed**: `HOMEBREW_NO_INSTALL_FROM_API=1`
  makes Homebrew read the local tap. Check that `$(brew --repository homebrew/cask)`
  exists and contains `Casks/<first-char>/<token>.rb`.
- **Audit failures**: run `brew style --fix <token>` first. For `--new`-only failures
  (repo or domain age, notability, signing), see SKILL.md Pre-flight - no cask edit fixes them.
- **Install failures**: check the URL resolves and the sha matches
  (`shasum -a 256 <file>`), then `brew install --cask --verbose <token>`.
- **Install hangs on a TTY**: it is waiting on a dependency confirmation prompt; rerun with `-y`.

## Quick reference

```bash
# Setup
brew tap --force homebrew/cask
cd "$(brew --repository homebrew/cask)"

# Author
brew generate-cask-token "<App Name>.app"
brew create --cask <url> --set-name <token>
brew generate-zap <token>

# Validate
brew style --fix <token>
brew audit --cask --online --os=all --arch=all <token>
brew audit --cask --new <token>
brew lgtm --online

# Test (token, never file path)
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
brew uninstall --cask <token>
brew uninstall --zap --cask <token>

# Bump an existing cask
brew bump --open-pr <token>
```

Cask file path: `Casks/<first-char>/<token>.rb`.

*Verified against Homebrew 7.0.7 and homebrew-cask main, 2026-09-28.*
