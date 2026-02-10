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
    mise
    pipx
    nixfmt
    tree-sitter
    jq
    yq-go
    gum
    usql
    postgresql
    lazysql
    witr

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

    # Networking & security
    tailscale
    nmap
    rustscan
    wgcf
    wireproxy
    cloudflared
    ttyd

    # Media & presentation
    yt-dlp
    ffmpeg
    presenterm
    charm-freeze
    rembg

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
  ];
}
