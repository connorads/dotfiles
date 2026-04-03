# ==============================================================================
# Linux Home-Manager Base Configuration
# ==============================================================================
# Shared configuration for all Linux home-manager users
{ pkgs, ... }:
{
  imports = [ ./home-shared.nix ];

  home.username = "connor";
  home.homeDirectory = "/home/connor";
  home.stateVersion = "24.11";

  news.display = "silent";

  # Enable Nix PATH and environment for non-NixOS Linux
  targets.genericLinux.enable = true;

  # Fonts (Nerd Font for terminal icons)
  fonts.fontconfig.enable = true;
  home.packages = [
    pkgs.nerd-fonts.fira-code
  ];

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  # Allow unfree packages
  nixpkgs.config.allowUnfree = true;
}
