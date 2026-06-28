# Homebrew Cask Contribution Workflow

A complete guide for contributing casks to Homebrew, covering local testing, validation, and submission.

## Prerequisites

- Homebrew installed
- Git configured
- Forked `Homebrew/homebrew-cask` repository on GitHub

## Setup: Link Your Local Repository

This override is temporary. Before changing anything, print the current Homebrew tap state/commands so the restore path is visible in-context. When testing is done, restore standard Homebrew state unless the user explicitly asks to keep the override.

### Initial Setup

If you have the homebrew-cask repository checked out locally, make Homebrew use your working copy for testing:

```bash
# 1. Untap the official cask tap
brew untap homebrew/cask

# 2. Symlink your git checkout to Homebrew's tap location
ln -s ~/path/to/your/homebrew-cask $(brew --repository)/Library/Taps/homebrew/homebrew-cask

# Verify it worked
ls -la $(brew --repository)/Library/Taps/homebrew/
```

Now any changes you make in your git repo are immediately live for Homebrew commands.

### Restore Official Tap (After Testing)

Restore when local validation/submission is done, usually after commit or PR creation. If you are about to leave Homebrew in a non-standard state, prompt first.

```bash
# Remove your symlink
rm $(brew --repository)/Library/Taps/homebrew/homebrew-cask

# Re-add official tap
brew tap homebrew/cask
```

## Creating a New Cask

### Pre-flight Checks

Before creating a new cask, verify the app meets Homebrew's acceptance criteria:

1. **Notability**: GitHub projects with <30 forks/watchers or <75 stars are likely rejected. The app must have meaningful public presence beyond "just `brew install`". See [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks).
2. **Repo age**: GitHub repos less than 30 days old cause a hard `brew audit --new` failure.
3. **Previously refused**: Search [closed unmerged PRs](https://github.com/search?q=repo%3AHomebrew%2Fhomebrew-cask+is%3Aclosed+is%3Aunmerged+&type=pullrequests) for the token.
4. **Existing PRs**: Check [open PRs](https://github.com/Homebrew/homebrew-cask/pulls) to avoid duplicates.

### 1. Determine the Token

The token is the unique identifier for your cask. Follow these rules:

**From app name to token:**

- Start with app bundle name (e.g., `Google Chrome.app`)
- Remove `.app` extension
- Remove suffixes: "App", version numbers, "for macOS"
- Remove "Mac" unless it distinguishes the product
- Remove "Desktop" only when it's a generic suffix — **keep it** when intrinsic to the product name (e.g., `Docker Desktop.app` → `docker-desktop`, `LTX Desktop.app` → `ltx-desktop`). When in doubt, keep "Desktop".
- Convert to lowercase
- Replace spaces/underscores with hyphens
- Remove non-alphanumeric characters (except hyphens)

**Examples:**

- `Google Chrome.app` → `google-chrome`
- `VLC Media Player.app` → `vlc`
- `Sublime Text 2.app` → `sublime-text`
- `Docker Desktop.app` → `docker-desktop`

**Special cases:**

- Beta/nightly: `app-name@beta`, `app-name@nightly`
- Version-specific: `app-name@5`

### 2. Create the Cask File

```bash
cd ~/path/to/your/homebrew-cask/Casks

# Determine the subdirectory (first letter/number of token)
# For token "my-app", create in: m/my-app.rb
# For token "1password", create in: 1/1password.rb

# Create the cask file
vim <first-char>/<token>.rb
```

### 3. Write the Cask Definition

**Required stanzas** (in canonical order):

```ruby
cask "token-name" do
  version "1.2.3"
  sha256 "abc123..." # Get with: shasum -a 256 <downloaded-file>

  url "https://example.com/app-#{version}.dmg"
  name "Official App Name"
  desc "Brief one-line description of what it does"
  homepage "https://example.com"

  app "AppName.app"
end
```

Every cask must have: `version`, `sha256`, `url`, `name`, `desc`, `homepage`, and at least one artifact stanza (`app`, `pkg`, `installer`, `suite`, etc.).

**Canonical stanza order:**

`version` → `sha256` → `url` → `name` → `desc` → `homepage` → `livecheck` → `auto_updates` → `depends_on` → artifacts → `uninstall` → `zap`

Run `brew style --fix <token>` to auto-correct ordering.

**Key points:**

- `version`: Use interpolation (`#{version}`) in URL when possible
- `sha256`: Calculate with `shasum -a 256 <file>`
- `url`: HTTPS preferred; add `verified:` if domain differs from homepage
- `desc`: Concise, no marketing fluff, start with capital letter
- `name`: Full official name with proper capitalization

**Common optional stanzas:**

- `depends_on macos:` - OS requirements (only when genuinely needed)
- `depends_on cask:` - Other required casks (only when genuinely needed)
- `livecheck` - Version checking automation
- `uninstall` - Required for `pkg`/`installer` artifacts; optional otherwise
- `zap` - Thorough cleanup (user files, preferences, caches). Recommended for new casks but not enforced by `brew audit`. Reviewers expect accurate paths — verify them manually.

### 4. Handle Different Architectures

If the app has separate downloads for Apple Silicon and Intel:

```ruby
cask "app-name" do
  arch arm: "aarch64", intel: "x86-64"

  version "1.2.3"
  sha256 arm:   "abc123...",
         intel: "def456..."

  url "https://example.com/app-#{version}-#{arch}.dmg"
  # ...
end
```

If versions differ by architecture:

```ruby
cask "app-name" do
  arch arm: "arm64", intel: "x86_64"

  on_arm do
    version "1.2.3"
    sha256 "abc123..."
  end
  on_intel do
    version "1.2.2"
    sha256 "def456..."
  end

  url "https://example.com/app-#{version}-#{arch}.dmg"
  # ...
end
```

## Validation Checklist

Follow the PR template requirements exactly:

### For All Casks (New or Updated)

```bash
# 1. Fix code style
brew style --fix <token>

# 2. Run audit (checks structure, URLs, naming)
brew audit --cask --online <token>
```

Both commands must pass with no errors before proceeding.

### For New Casks Only

```bash
# 1. Check token follows naming rules
# Manually verify against docs: https://docs.brew.sh/Cask-Cookbook#token-reference

# 2. Check cask wasn't previously refused
# Search: https://github.com/Homebrew/homebrew-cask/pulls?q=is%3Apr+is%3Aclosed+is%3Aunmerged+<token>

# 3. Run new cask audit
brew audit --cask --new <token>

# 4. Test installation — always use TOKEN, never file path
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>

# 5. Verify the app works
open /Applications/AppName.app

# 6. Test uninstallation
brew uninstall --cask <token>

# 7. Verify cleanup
ls /Applications/ | grep AppName  # Should return nothing
```

**Important:** Always install by token name (e.g., `brew install --cask my-app`), never by file path (e.g., `./Casks/m/my-app.rb`). File path installs fail when using the tap symlink workflow.

**Common audit issues:**

- Missing `verified:` when URL domain ≠ homepage domain
- Description too long (>80 chars) or contains marketing fluff
- Token doesn't follow naming conventions
- SHA256 mismatch
- GitHub repo less than 30 days old (hard failure for `--new` audit)
- App doesn't meet notability thresholds (<30 forks/watchers or <75 stars)

## Testing Tips

### Dry Run (See What Would Happen)

```bash
brew install --cask --dry-run <token>
```

### Force Reinstall (After Changes)

```bash
brew reinstall --cask <token>
```

### Test Uninstall with Zap

```bash
brew uninstall --cask --zap <token>
```

### Check What Files Were Installed

```bash
# For pkg-based casks
pkgutil --files <bundle.id>

# For app-based casks
ls -la /Applications/AppName.app
```

## Common Cask Patterns

### App with Binary

```ruby
app "MyApp.app"
binary "#{appdir}/MyApp.app/Contents/MacOS/mytool"
```

### PKG Installer

```ruby
pkg "Installer.pkg"

uninstall pkgutil: "com.vendor.app.*"
```

### Suite (Multiple Apps)

```ruby
suite "AppSuite"  # Directory containing multiple .app bundles
```

### With Dependencies

```ruby
depends_on macos: ">= :monterey"
depends_on cask: "other-required-app"
```

### Cross-platform (macOS + Linux / AppImage)

One cask can target both OSes: shared top-level stanzas (`version`, `sha256`, `url`, `name`, `desc`, `homepage`, `livecheck`), then sibling `on_macos` / `on_linux` blocks for the platform-specific artifacts — don't nest one inside the other (not a brew error; the OS conditions are mutually exclusive, so a nested block is unreachable dead code). On Linux the artifact is usually `app_image` (an AppImage), declared inside `on_linux`.

```ruby
cask "app-name" do
  on_macos do
    arch arm: "arm64", intel: "x86_64"
  end
  on_linux do
    arch arm: "aarch64", intel: "amd64"     # arch strings often differ per OS — check upstream asset names
  end

  version "1.2.3"
  sha256 arm:          "...",
         intel:        "...",
         arm64_linux:  "...",
         x86_64_linux: "..."

  url_end = on_system_conditional linux: ".AppImage", macos: ".dmg"
  url "https://github.com/owner/repo/releases/download/v#{version}/AppName_#{version}_#{arch}#{url_end}",
      verified: "github.com/owner/repo/"
  name "App Name"
  desc "Short one-line description"
  homepage "https://example.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  on_macos do
    depends_on macos: :monterey
    app "AppName.app"
    zap trash: [
      "~/Library/Application Support/AppName",
      "~/Library/Preferences/com.example.app.plist",
    ]
  end

  on_linux do
    app_image "AppName_#{version}_#{arch}.AppImage", target: "AppName.AppImage"
  end
end
```

`app_image` mechanics:

- **Stanza name** is `app_image` (snake_case, auto-derived from `Cask::Artifact::AppImage`), not `appimage`. It is **Linux-only**: gate it inside `on_linux`. An ungated `app_image` makes a macOS install raise `This cask requires Linux.` (current main prepends the cask token: `"<cask>: This cask requires Linux."`; the original AppImage commits `3ca53a26`/`48ac0fb5` raised `"Linux is required for this software."`); conversely the macOS-only artifacts (`app`, `pkg`, `suite`, `qlplugin`, `prefpane`, `vst_plugin`, ...) raise `This cask requires macOS.` on Linux unless gated inside `on_macos`. Top-level `depends_on :linux` is for a *Linux-only* cask — it deliberately blocks macOS install, so don't use it to gate a cross-platform cask.
- **Signature**: `app_image "<source-filename-in-archive>", target: "<symlink-name>"`. `target:` is optional (defaults to the source basename) — always pass a stable name (e.g. `AppName.AppImage`) when the source embeds version/arch, so upgrades don't accumulate per-version symlinks.
- **Install**: symlinks the source into `appimagedir` (default `~/Applications` on **both** macOS and Linux — `appdir`, by contrast, becomes `~/.config/apps` on Linux) and `chmod +x`s it. `brew uninstall` removes the symlink, so no `uninstall` stanza is needed. Override per-install with `--appimagedir=PATH`; don't hardcode the install path in `zap`.
- **Linux user-state cleanup**: by convention `zap` is **omitted** from the `on_linux` block for AppImage casks. Verified against `agentsview`, `zen`, `tabby` in `homebrew-cask` — all three put `zap trash:` only inside `on_macos` and have no `zap` inside `on_linux`. The install only drops a single symlink into `appimagedir` that `brew uninstall` already removes, so there's nothing for `zap` to reverse. User config/cache (e.g. `~/.config/<appid>`, `~/.cache/<appid>`, `~/.local/share/<appid>`, `~/.<appname>`) is created by the app at *runtime*, not at install time, and Homebrew leaves it alone by the same principle that makes `zap` optional (not required) even on macOS. `brew audit --cask` does not require `zap` on any OS (`cask/audit.rb:audit_required_stanzas` only checks `version`, `sha256`, `url`, `homepage`, `name`, and one activatable artifact; `:zap` and `:uninstall` are explicitly excluded from the activatable count). Only add a Linux `zap` if you have a specific reason and have manually verified the XDG paths (no `generate-zap` on Linux — clone the upstream repo and grep for `os.homedir()` / `env-paths` / `xdg.*` to find them).
- **`brew style`** has no stanza-order position for `app_image`, so it won't be auto-reordered. Place it alone inside `on_linux` (or after other artifacts if declared at top level) and run `brew style --fix` for everything else.
- **sha256 / version per OS**: **when all four arches build exist (macOS arm + intel, Linux arm64 + x86_64), put them in a single top-level `sha256` block — this is maintainer-preferred, not split per-OS.** The Cask Cookbook documents inline arch-keyed `sha256` as the default; reserve per-OS / `on_arch` splits for when `version` or build shape differs per arch (4/4 genuine four-arch casks use one block). Split `sha256`/`version` into `on_macos`/`on_linux` blocks only when one OS's sha is unkeyed (single-arch) or the key set genuinely differs. The canonical macOS-Intel key is `x86_64:`; `intel:` is an accepted alias coalesced into it — real four-arch casks like `agentsview` use `x86_64:`. Add an `os macos:/linux:` stanza only when the asset name embeds an OS string (see `tabby`, `git-credential-manager`).

Real cross-platform casks to model on: `agentsview`, `zen`, `zettlr`, `tabby`, `beekeeper-studio` (AppImage on Linux); `t3-code` (single-arch x86_64 AppImage — see below); `git-credential-manager` (cross-platform via the `os` stanza, but ships a `binary` on Linux, not an AppImage).

Use the per-OS `arch` block shape (above) when arch strings differ per OS and both OSes are multi-arch; use the top-level `arch` helper + split `sha256` shape (below) when one OS ships a single arch (`t3-code`).

### Cross-platform with single-arch Linux AppImage

When the Linux build ships for only one arch (e.g. x86_64 only), do not use the `x86_64_linux:`/`arm64_linux:` keys and do not put `depends_on arch:` at top level (it would block macOS). Instead put a plain (unkeyed) `sha256` **and** `depends_on arch: :x86_64` *inside* `on_linux`, and use `on_system_conditional` to switch the artifact filename. Model on `t3-code` in `homebrew-cask`:

```ruby
cask "app-name" do
  arch arm: "arm64", intel: "x64"   # macOS arch strings only

  version "1.2.3"

  artifact = on_system_conditional linux:  "AppName-#{version}-x86_64.AppImage",
                                   macos: "AppName-#{version}-#{arch}.dmg"

  url "https://github.com/owner/repo/releases/download/v#{version}/#{artifact}",
      verified: "github.com/owner/repo/"
  name "App Name"
  desc "Short one-line description"
  homepage "https://example.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  on_macos do
    sha256 arm:   "...",
           intel: "..."
    depends_on macos: :monterey
    app "AppName.app"
    zap trash: [
      "~/Library/Application Support/AppName",
      "~/Library/Preferences/com.example.app.plist",
    ]
  end

  on_linux do
    sha256 "..."                     # plain, unkeyed — only one Linux arch exists
    depends_on arch: :x86_64
    app_image artifact, target: "AppName.AppImage"
  end
end
```

Key points:
- The `arch` helper is declared for the macOS side only (used inside the `#{arch}` interpolation of the macOS `.dmg` name). The Linux artifact name is hardcoded to `x86_64` (no `arm64_linux` build exists to switch on).
- `sha256` inside `on_linux` is plain/unkeyed — there's only one Linux artifact. Using `x86_64_linux:` here would imply a `arm64_linux:` value that doesn't exist.
- `depends_on arch: :x86_64` lives inside `on_linux` so it only constrains the Linux install; a top-level `depends_on arch:` would spill onto macOS and block Apple-Silicon users.
- **`auto_updates true` goes inside `on_macos`**, never top-level, for cross-platform casks. The AppImage side is a static symlink with no in-place updater, so a top-level declaration misrepresents the Linux artifact. Only the macOS `.app` self-updates (Sparkle/Tauri updater); gate the assertion there. Model: `t3-code`, `agentsview`.
- `t3-code` is the canonical example in `homebrew-cask` (x86_64-only AppImage, macOS+Linux cross-platform).

_Verified against Homebrew source (`cask/artifact/appimage.rb`, `cask/config.rb`, `cask/audit.rb`, `cask/dsl.rb`, `rubocops/cask/constants/stanza.rb`) as of June 2026._

### Livecheck (Version Auto-detection)

```ruby
livecheck do
  url "https://example.com/releases"
  strategy :sparkle
end
```

## Submitting Your Contribution

### 1. Commit Your Changes

```bash
cd ~/path/to/your/homebrew-cask

# Check what you've changed
git status
git diff

# Stage the new/modified cask
git add Casks/<letter>/<token>.rb

# Commit with correct message format (first line <=50 chars)
# New cask:        "token version (new cask)"
# Version update:  "token version"
# Fix/change:      "token: description"
git commit -m "my-app 1.0.0 (new cask)"
```

### 2. Push to Your Fork

```bash
git push origin <your-branch-name>
```

### 3. Create Pull Request

Target the `main` branch (not `master`):

```bash
gh pr create --base main --title "my-app 1.0.0 (new cask)" --body-file - <<'EOF'
Built and tested locally on macOS [version].

[One sentence if not obvious from title.]
EOF
```

Or via the GitHub web UI — fill in the PR template with:
- Brief description
- Checkboxes ticked ONLY if you completed each step
- AI disclosure (see below)

### 4. AI Disclosure

The PR template includes an AI disclosure section. If AI assisted with the PR:
- Check the AI checkbox in the template.
- Briefly describe how AI was used.
- Confirm that all changes were personally reviewed, tested, and verified — especially `zap` stanza paths.

### 5. Respond to Review

Maintainers may request changes. To update:

```bash
# Make requested changes
vim Casks/<letter>/<token>.rb

# Re-run validation
brew style --fix <token>
brew audit --cask --online <token>

# Test again
brew reinstall --cask <token>

# Commit and push (do not squash after opening PR)
git add Casks/<letter>/<token>.rb
git commit -m "Address review feedback: <what you changed>"
git push origin <your-branch-name>
```

## Troubleshooting

### "Cask not found"

Ensure you're using `HOMEBREW_NO_INSTALL_FROM_API=1` to force local file usage:

```bash
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
```

### File Path Install Fails

Do **not** install by file path (e.g., `brew install ./Casks/t/token.rb`). This fails with the tap symlink workflow. Always use the token name:

```bash
brew install --cask <token>
```

### Symlink Issues

Verify your symlink:

```bash
ls -la $(brew --repository)/Library/Taps/homebrew/homebrew-cask
# Should point to your git repo
```

### Audit Failures

Common fixes:

- `brew style --fix <token>` for formatting
- Check `verified:` parameter if URL/homepage domains differ
- Ensure `desc` is concise (<80 chars)
- Verify SHA256: `shasum -a 256 <file>`
- GitHub repo <30 days old: wait until the repo ages past 30 days
- Notability thresholds not met: check [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks) criteria

### Installation Failures

- Check the actual error message carefully
- Verify the download URL works in browser
- Test with `--verbose` flag: `brew install --cask --verbose <token>`
- Check if app requires specific macOS version

## Quick Reference

**Essential Commands:**

```bash
# Setup
brew untap homebrew/cask
ln -s ~/homebrew-cask $(brew --repository)/Library/Taps/homebrew/homebrew-cask

# Validation
brew style --fix <token>
brew audit --cask --online <token>
brew audit --cask --new <token>  # New casks only

# Testing (always use token, never file path)
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask <token>
brew uninstall --cask <token>
brew reinstall --cask <token>

# Cleanup
rm $(brew --repository)/Library/Taps/homebrew/homebrew-cask
brew tap homebrew/cask
```

**File Locations:**

- Casks: `Casks/<first-char>/<token>.rb`
- Helper scripts: `developer/bin/`

**PR Target:**

- Base branch: `main` (not `master`)

**Key Documentation:**

- Token reference: https://docs.brew.sh/Cask-Cookbook#token-reference
- Acceptable casks: https://docs.brew.sh/Acceptable-Casks
- Full cookbook: https://docs.brew.sh/Cask-Cookbook
