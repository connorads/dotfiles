# ==============================================================================
# Linux Packages Configuration
# ==============================================================================
# Full package set for Linux workstations
{ pkgs, packages, ... }:
{
  # Apps we want to install on Linux but not on macOS
  home.packages = packages.sharedPackages ++ [
    pkgs.vscode
    pkgs.bind
    pkgs.libnotify
    pkgs.lynis
  ];
}
