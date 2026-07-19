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

  # Automatic daily GC (systemd user timer), matching the darwin policy in
  # darwin-shared.nix. Persistent=true (module default) catches up missed runs;
  # on headless hosts the user systemd instance must be up for the timer to
  # fire - `sudo loginctl enable-linger connor` if generations pile up between
  # logins. User-profile scope only; rpi5's system GC is owned by the rpi5 repo.
  nix.gc = {
    automatic = true;
    options = "--delete-older-than 14d";
    dates = "03:15";
  };

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
