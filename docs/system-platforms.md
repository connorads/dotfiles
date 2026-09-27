# System platforms

## Nix Targets

```text
darwinConfigurations."Connors-Mac-mini"     # macOS Mac mini via nix-darwin + home-manager
darwinConfigurations."Connors-MacBook-Air"  # macOS MacBook Air via nix-darwin + home-manager
homeConfigurations."connor@penguin"         # Chromebook Linux
homeConfigurations."connor@dev"          # Remote x86_64 Linux (bare name = live box's arch)
homeConfigurations."connor@dev-aarch64-linux"  # Remote dev box, aarch64 variant
homeConfigurations."connor@dev-x86_64-linux"   # Remote dev box, x86_64 variant
homeConfigurations."connor@rpi5"         # Raspberry Pi 5 (aarch64, server packages, user env only)
homeConfigurations."codespace"           # GitHub Codespaces (minimal)
# RPi5 NixOS system config: github.com/connorads/rpi5
```

### Hybrid NixOS (rpi5)

The rpi5 uses a hybrid setup - two repos, two rebuilds:

- **System** (`nrs`): NixOS config from `~/git/rpi5` (set via `NIXOS_FLAKE` in `.zshrc.local`)
- **User env** (`hms`): shell, tools, git, tmux etc. from dotfiles (`~/.config/nix`)

The `up` function runs both on NixOS. An agent on rpi5 can modify the system config (rpi5 repo) without touching dotfiles.

## Xcode

Nix does not install Xcode. MAS serves latest only, so a `masApps` entry is a
standing upgrade across majors with no pinning and no way to hold one back.
When a project needs Xcode, add `xcodes` to mise (`aqua:XcodesOrg/xcodes`,
macOS-only via `os = ["macos"]` - its release assets are all Homebrew bottles)
and let it manage versions side by side; that route authenticates against the
developer portal rather than the App Store.

`brew bundle cleanup` only uninstalls formulae, casks and taps, so `cleanup =
"zap"` never removes a MAS app. An Xcode installed while it was a `masApps`
entry stays on disk until deleted by hand.

The Command Line Tools stay installed as the baseline: `xcode-select -p` points
at `/Library/Developer/CommandLineTools` until something moves it. Three
derivations compile against whatever `xcrun --show-sdk-path` returns -
[biokc.nix](../.config/nix/modules/biokc.nix),
[imagepaste.nix](../.config/nix/modules/imagepaste.nix),
[voxtap.nix](../.config/nix/modules/voxtap.nix), plus the shim in
[terminal-control.nix](../.config/nix/packages/terminal-control.nix) - so
selecting an Xcode changes their SDK on the next `drs`. Each falls back to the
CLT SDK path when `xcrun` fails, which is why the CLT must not be removed.

First run of a fresh Xcode needs `sudo xcodebuild -license accept` and
`xcodebuild -runFirstLaunch`. Simulator runtimes are a separate ~7-10 GB each
(`xcodebuild -downloadPlatform iOS`); install them only when a project needs one.

## Dependency ownership: Nix, mise, Homebrew

- **Nix** owns the machine layer: base shell tools, services, fonts, native libraries, patched builds, tools mise needs, and GUI apps that are healthy in nixpkgs.
- **mise** owns the developer-tool layer: runtimes, package managers, project tools, npm/pipx/aqua/github/cargo CLIs, fast-moving vendor CLIs like Claude and Codex.
- **Homebrew** is the macOS app lane: casks, MAS apps, vendor bundles, self-updating apps, drivers, and anything whose signing or app-bundle integration works better through brew.

Rule of thumb: host-global and well-packaged -> Nix; project/version-selected ->
mise; macOS vendor bundle -> Homebrew.

Claude Code is mise-owned. Do not install it natively or re-enable its self-updater. Why: [docs/adr/0011](../docs/adr/0011-claude-binary-is-not-patched-and-mise-owns-the-install.md).
