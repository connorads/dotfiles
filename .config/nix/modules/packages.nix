# ==============================================================================
# Shared Package Sets — additive tiers
#
# corePackages   = core                              (ephemeral/codespaces)
# serverPackages = core + serverExtras               (headless/SSH)
# sharedPackages = core + serverExtras + workstation  (macOS/Linux desktop)
# ==============================================================================
{ pkgs }:
let
  # xclip shim: delegates to osc for headless/SSH environments
  xclip-osc = pkgs.writeShellApplication {
    name = "xclip";
    runtimeInputs = [ pkgs.osc ];
    text = ''
      for arg in "$@"; do
        case "$arg" in -o|-out) exit 1 ;; esac
      done
      exec osc copy
    '';
  };

  # mise 2026.6.11's oci-layer test asserts setuid bits survive a round-trip,
  # but the macOS Nix build sandbox strips them, so the test fails
  # deterministically (and the build isn't cached, forcing a source build).
  # Skip just that test; keep mise's other build-time checks. Remove once the
  # binary cache has 2026.6.11 or upstream fixes the test.
  mise = pkgs.mise.overrideAttrs (old: {
    checkFlags = (old.checkFlags or [ ]) ++ [
      "--skip=oci::layer::tests::preserve_metadata_dir_layer_keeps_special_permission_bits"
    ];
  });

  # ---------------------------------------------------------------------------
  # Tier 1: Minimal — ephemeral environments (codespaces, containers)
  # ---------------------------------------------------------------------------
  corePackages = with pkgs; [
    # Shell & terminal
    zsh
    tmux
    kitty.terminfo

    # Editors
    vim
    micro

    # Navigation & search
    fd
    ripgrep
    sd # intuitive find & replace (sed replacement); pairs with fd/rg
    fzf
    zoxide
    tree
    eza

    # Git
    delta

    # Data
    jq

    # System
    coreutils
    bat

    # Networking
    wget
    tailscale

    # Dev tools
    mise
  ];

  # ---------------------------------------------------------------------------
  # Tier 2 extras: Server/headless — "feels like home" over SSH
  # ---------------------------------------------------------------------------
  serverExtras = with pkgs; [
    # Navigation
    yazi

    # Git & VCS
    difftastic
    lazygit
    lazyworktree
    jujutsu
    jjui
    # CLI utilities
    bc
    gnupg
    glow
    bottom
    dust
    ncdu
    tealdeer
    yq-go
    gum
    zstd

    # Dev tools
    nixfmt
    tree-sitter

    # Clipboard (OSC 52)
    osc
    xclip-osc

    # Data
    sqlite

    # Networking
    nmap
    bandwhich
    cloudflared
    mosh
    ttyd
  ];

  # ---------------------------------------------------------------------------
  # Tier 3 extras: Workstation — desktop, media, heavy-dev
  # ---------------------------------------------------------------------------
  workstationExtras = with pkgs; [
    # Dev tools
    pipx
    miller
    usql
    duckdb
    ollama
    postgresql
    lazysql
    witr

    # PHP & WordPress
    php84
    php84Packages.composer

    # System utilities
    parallel-disk-usage

    # Web browsing
    w3m
    monolith

    # Networking & security
    rustscan
    wgcf
    wireproxy

    # Media & presentation
    android-tools # adb — needed by scrcpy
    scrcpy
    qrencode
    (yt-dlp.override { javascriptSupport = false; }) # deno (Rust) is slow to build; yt-dlp finds deno on PATH (mise) at runtime
    ffmpeg
    imagemagick
    libwebp
    poppler-utils
    presenterm
    charm-freeze

    # Sync & backup
    rclone
    unison

  ];
in
{
  inherit corePackages;
  serverPackages = corePackages ++ serverExtras;
  sharedPackages = corePackages ++ serverExtras ++ workstationExtras;
}
