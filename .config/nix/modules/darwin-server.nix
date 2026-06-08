# ==============================================================================
# macOS (nix-darwin) Configuration — Headless server (Mac mini)
# ==============================================================================
#
# Repurposes the M4 Mac mini into an unattended remote dev box reachable only
# over Tailscale SSH (no display/keyboard, no native sshd). Imported alongside
# darwin-shared.nix.
#
# Intended differences vs the old shared desktop config on this host:
#   - no desktop casks/masApps (homebrew zap removes them on first switch;
#     MAS apps RunCat/Perplexity are NOT zapped — remove manually)
#   - no sudo_local → sudo falls through to password (no Touch ID / key here)
#   - no GUI app packages, no UI defaults, no app associations / credential helper
#   - never sleeps, auto-restarts after power loss, manual OS updates only
#
# FileVault is ON (manual `sudo fdesetup enable`; nix-darwin has no option for
# it). Unplanned power loss waits at the pre-boot unlock prompt — use
# `fdesetup authrestart` for planned reboots, never bare `reboot`.
{
  lib,
  pkgs,
  packages,
  ...
}:
{
  networking.hostName = "Connors-Mac-mini";

  # -- System Packages --
  # Server's own subset (no GUI apps). The tailscaled daemon in darwin-shared.nix
  # also needs pkgs.tailscale, but that is independent of this list.
  environment.systemPackages = [
    pkgs.docker
    pkgs.colima
    pkgs.tart
    pkgs.tailscale
  ];

  # -- Power: never sleep, recover from power loss --
  # `computer = "never"` is a first-class option; autorestart/disablesleep/etc.
  # are not nix-darwin options, hence the pmset script below.
  power.sleep.computer = "never";

  # pmset via lib.mkAfter (priority 1500) sorts after shared's MagicDNS resolver.
  # Server-only — does not touch the Air.
  #   autorestart 1   — power back on after a power failure
  #   disablesleep 1  — never sleep (belt-and-braces with power.sleep.computer)
  #   displaysleep 0  — no display sleep (headless, but keeps the GPU live)
  #   powernap 0      — no Power Nap wake cycles
  system.activationScripts.postActivation.text = lib.mkAfter ''
    /usr/bin/pmset -a autorestart 1 disablesleep 1 displaysleep 0 powernap 0
  '';

  # -- OS updates: manual only --
  # Keep automatic *checks* on for visibility, but never auto-download/install
  # or reboot — an unattended FileVault box must not reboot itself into the
  # pre-boot unlock wall.
  system.defaults.SoftwareUpdate.AutomaticallyInstallMacOSUpdates = false;
  system.defaults.CustomUserPreferences."com.apple.SoftwareUpdate" = {
    AutomaticCheckEnabled = true;
    AutomaticDownload = false;
    CriticalUpdateInstall = false;
    ConfigDataInstall = false;
  };

  # -- Services (later) --
  # Persistent container services aren't wanted yet. When they are, a boot
  # daemon to bring Colima up headlessly goes here, e.g.:
  #
  # launchd.daemons.colima = {
  #   serviceConfig = {
  #     Label = "dev.colima.boot";
  #     ProgramArguments = [ "${pkgs.colima}/bin/colima" "start" ];
  #     RunAtLoad = true;
  #     KeepAlive = false;
  #     StandardOutPath = "/var/log/colima.log";
  #     StandardErrorPath = "/var/log/colima.err.log";
  #   };
  # };

  # -- Home Manager (server additions) --
  # Full toolkit (matches connor@dev). No duti/pngpaste, no defaultAppAssociations,
  # no osxkeychain credential helper (SSH remotes + gh-gate instead).
  home-manager.users.connorads = {
    home.packages = packages.sharedPackages;
  };

  # NB: no security.pam.services.sudo_local here (password sudo).
  # services.openssh stays enable = false (inherited from shared); remote access
  # is Tailscale SSH, configured out-of-band in the tailnet ACL.
}
