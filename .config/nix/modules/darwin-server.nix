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

  # -- Power: stay awake, but blank + lock the idle display --
  # The box never sleeps (remote dev must stay reachable), but the physical
  # screen turns off after 10 min idle and the session locks, so an unattended
  # headed Mac mini isn't left showing an unlocked desktop. `disablesleep` only
  # gates *system* sleep, not display sleep, so the two coexist.
  #
  # `computer = "never"` is a first-class option; autorestart/disablesleep/etc.
  # are not nix-darwin options, hence the pmset script below.
  power.sleep.computer = "never";

  # Require the login password the moment the display sleeps / screen saver
  # starts (delay 0 = immediate). CustomUserPreferences is used over the
  # `screensaver` options to stay decoupled from nix-darwin option churn.
  system.defaults.CustomUserPreferences."com.apple.screensaver" = {
    askForPassword = 1;
    askForPasswordDelay = 0;
  };

  # pmset via lib.mkAfter (priority 1500) sorts after shared's MagicDNS resolver.
  # Server-only — does not touch the Air.
  #   autorestart 1   — power back on after a power failure
  #   disablesleep 1  — never system-sleep (belt-and-braces with power.sleep.computer)
  #   displaysleep 10 — blank the screen after 10 min idle (pairs with the lock above)
  #   powernap 0      — no Power Nap wake cycles
  system.activationScripts.postActivation.text = lib.mkAfter ''
    /usr/bin/pmset -a autorestart 1 disablesleep 1 displaysleep 10 powernap 0

    # -- mosh-server: allow inbound UDP through the Application Firewall --
    # ALF silently drops inbound UDP to *unsigned* binaries unless they are
    # allow-listed by path (no signature to key on, so it falls back to the
    # path). mosh-server is an adhoc-signed Nix binary, so SSH (TCP, system
    # path) connects but mosh's UDP data channel is dropped — the classic
    # "mosh: Nothing received from server on UDP port" with a working ssh.
    # Its /nix/store path changes on every upgrade, so we re-assert the allow
    # for the current mosh-server each rebuild and prune entries left by prior
    # store paths, keeping the ALF list clean. Server-only: the Air deliberately
    # stays un-mosh-able (no inbound mosh allowed there).
    #
    # The `{ ...; } || true` wrapper is load-bearing: activation runs under
    # `set -e` + `set -o pipefail`, and the prune grep exits non-zero when there
    # is nothing to prune (the common case) — without the guard that aborts the
    # entire activation mid-switch. The wrapper disables `set -e` for the block.
    {
      fw=/usr/libexec/ApplicationFirewall/socketfilterfw
      mosh_server=${pkgs.mosh}/bin/mosh-server
      stale=$("$fw" --listapps 2>/dev/null | grep -oE '/nix/store/[^ ]*mosh[^ ]*/bin/mosh-server' || true)
      for old in $stale; do
        [ "$old" = "$mosh_server" ] || "$fw" --remove "$old" >/dev/null 2>&1 || true
      done
      "$fw" --add "$mosh_server" >/dev/null 2>&1 || true
      "$fw" --unblockapp "$mosh_server" >/dev/null 2>&1 || true
      echo "Allowed mosh-server through Application Firewall: $mosh_server"
    } || true
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
