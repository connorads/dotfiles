# ==============================================================================
# Linux Codespaces Packages Configuration
# ==============================================================================
# Minimal package set for ephemeral environments (GitHub Codespaces)
{ packages, ... }:
{
  home.packages = packages.corePackages;
}
