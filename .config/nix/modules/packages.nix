# ==============================================================================
# Shared Package Sets — additive tiers
#
# corePackages   = core                              (ephemeral/codespaces)
# serverPackages = core + serverExtras               (headless/SSH)
# sharedPackages = core + serverExtras + workstation  (macOS/Linux desktop)
# ==============================================================================
{ pkgs }:
let
  # Bare repo wrapper that works even with empty $HOME
  dotfiles = pkgs.writeShellApplication {
    name = "dotfiles";
    runtimeInputs = [ pkgs.git ];
    text = ''
      home="''${HOME:-$(eval echo ~)}"
      exec git --git-dir="$home/git/dotfiles" --work-tree="$home" "$@"
    '';
  };

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

  # ---------------------------------------------------------------------------
  # Tier 1: Minimal — ephemeral environments (codespaces, containers)
  # ---------------------------------------------------------------------------
  corePackages = with pkgs; [
    # Shell & terminal
    zsh
    tmux
    kitty.terminfo
    starship

    # Editors
    vim
    micro

    # Navigation & search
    fd
    ripgrep
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
    dotfiles

    # CLI utilities
    bc
    glow
    bottom
    dust
    ncdu
    tealdeer
    yq-go
    gum
    zstd

    # Dev tools
    gcc
    nixfmt
    tree-sitter

    # Clipboard (OSC 52)
    osc
    xclip-osc

    # Networking
    nmap
    cloudflared
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

    # Networking & security
    rustscan
    wgcf
    wireproxy

    # Media & presentation
    (yt-dlp.override { javascriptSupport = false; }) # deno (Rust) is slow to build; yt-dlp finds deno on PATH (mise) at runtime
    ffmpeg
    imagemagick
    libwebp
    presenterm
    charm-freeze
    # rembg CLI without gradio (rembg s server won't work; rembg i/p/b still work)
    (pkgs.python3Packages.toPythonApplication (
      (pkgs.python3Packages.rembg.override { withCli = true; }).overrideAttrs (old: {
        propagatedBuildInputs = builtins.filter (
          p: (p.pname or p.name or "") != "gradio"
        ) old.propagatedBuildInputs;
      })
    ))

    # Sync & backup
    rclone
    unison

    # Apps
    telegram-desktop
  ];
in
{
  inherit corePackages;
  serverPackages = corePackages ++ serverExtras;
  sharedPackages = corePackages ++ serverExtras ++ workstationExtras;
}
