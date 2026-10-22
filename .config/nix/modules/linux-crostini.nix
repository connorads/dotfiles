# ==============================================================================
# Crostini (Chrome OS Linux) Desktop Integration
# ==============================================================================
# Exposes Nix apps to Chrome OS launcher via cros-garcon service overrides.
# Only used by the penguin (Chromebook) configuration.
{
  # Extend cros-garcon's PATH and XDG_DATA_DIRS to include Nix profile
  xdg.configFile."systemd/user/cros-garcon.service.d/override.conf".text = ''
    [Service]
    Environment="PATH=%h/.nix-profile/bin:/usr/local/sbin:/usr/local/bin:/usr/local/games:/usr/sbin:/usr/bin:/usr/games:/sbin:/bin"
    Environment="XDG_DATA_DIRS=%h/.nix-profile/share:%h/.local/share:%h/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share"
  '';
}
