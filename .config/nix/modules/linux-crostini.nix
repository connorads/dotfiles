# ==============================================================================
# Crostini (Chrome OS Linux) Desktop Integration
# ==============================================================================
# Exposes Nix apps to Chrome OS launcher via cros-garcon service overrides.
# Only used by the penguin (Chromebook) configuration.
{ pkgs, ... }:
let
  vscode = pkgs.vscode;
in
{
  # Extend cros-garcon's PATH and XDG_DATA_DIRS to include Nix profile
  xdg.configFile."systemd/user/cros-garcon.service.d/override.conf".text = ''
    [Service]
    Environment="PATH=%h/.nix-profile/bin:/usr/local/sbin:/usr/local/bin:/usr/local/games:/usr/sbin:/usr/bin:/usr/games:/sbin:/bin"
    Environment="XDG_DATA_DIRS=%h/.nix-profile/share:%h/.local/share:%h/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share"
  '';

  # Desktop file in standard location (garcon uses inotify, doesn't follow Nix symlinks)
  xdg.dataFile."applications/code.desktop".source = "${vscode}/share/applications/code.desktop";

  # Icon in hicolor theme (garcon looks here, not in pixmaps)
  xdg.dataFile."icons/hicolor/512x512/apps/vscode.png".source = "${vscode}/share/pixmaps/vscode.png";
  xdg.dataFile."icons/hicolor/index.theme".text = ''
    [Icon Theme]
    Name=Hicolor
    Comment=Fallback icon theme
    Directories=512x512/apps

    [512x512/apps]
    Size=512
    Context=Applications
    Type=Fixed
  '';
}
