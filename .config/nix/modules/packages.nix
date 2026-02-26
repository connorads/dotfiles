# ==============================================================================
# Shared Package Sets
# ==============================================================================
{ pkgs }:
{
  # Full package set for macOS and Linux workstations
  sharedPackages = with pkgs; [
    # Shell & terminal
    zsh
    tmux
    kitty.terminfo
    starship

    # Text editors
    vim
    micro

    # File navigation & search
    fd
    ripgrep
    fzf
    zoxide
    tree
    yazi
    eza

    # Git & version control
    delta
    difftastic
    lazygit
    lazyworktree
    jujutsu

    # Dotfiles (bare repo wrapper that works even with empty $HOME)
    (writeShellScriptBin "dotfiles" ''
      home="''${HOME:-$(eval echo ~)}"
      exec ${git}/bin/git --git-dir="$home/git/dotfiles" --work-tree="$home" "$@"
    '')

    # Dev tools
    gcc
    mise
    pipx
    nixfmt
    tree-sitter
    jq
    yq-go
    miller
    gum
    usql
    duckdb
    ollama
    postgresql
    lazysql
    witr

    # PHP & WordPress
    php84
    php84Packages.composer

    # Command reference
    tealdeer

    # System utilities
    coreutils
    bc
    bat
    glow
    bottom
    dust
    ncdu
    parallel-disk-usage
    zstd

    # Clipboard (OSC 52 over SSH)
    osc # OSC 52 clipboard tool (osc copy / osc paste)
    (writeShellScriptBin "xclip" ''
      # xclip shim: delegates to osc for headless/SSH environments
      # Falls back to real xclip when a display server is available
      for arg in "$@"; do
        case "$arg" in -o|-out) exit 1 ;; esac
      done
      exec ${osc}/bin/osc copy
    '')

    # Web browsing
    w3m

    # Networking & security
    tailscale
    nmap
    rustscan
    wgcf
    wireproxy
    cloudflared
    ttyd

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
        propagatedBuildInputs = builtins.filter
          (p: (p.pname or p.name or "") != "gradio")
          old.propagatedBuildInputs;
      })
    ))

    # Sync & backup
    rclone
    unison

    # Apps
    telegram-desktop
  ];

  # Minimal package set for ephemeral environments (codespaces, containers)
  corePackages = with pkgs; [
    zsh
    tmux
    kitty.terminfo
    starship
    vim
    micro
    fd
    ripgrep
    fzf
    zoxide
    tree
    eza
    bat
    delta
    jq
    coreutils
    tailscale
    mise
    atuin
  ];
}
