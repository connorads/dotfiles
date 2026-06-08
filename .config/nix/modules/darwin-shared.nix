# ==============================================================================
# macOS (nix-darwin) Configuration — Shared base (both Macs)
# ==============================================================================
#
# Host-neutral foundation imported by every darwinConfiguration. Per-host
# concerns live in darwin-desktop.nix (Air) and darwin-server.nix (mini).
#
# The home-manager.users.connorads submodule references `pkgs`/`packages` by
# closing over this function's args (home-manager sets no extraSpecialArgs on
# darwin). The per-host modules add their own home.packages etc. by merging
# further definitions of the same submodule. Non-merging scalars
# (home.username/homeDirectory/stateVersion) are defined HERE, exactly once.
{
  self,
  pkgs,
  ...
}:
{
  # -- Fonts --
  fonts.packages = with pkgs; [
    fira-code
    nerd-fonts.fira-code
  ];

  # -- Homebrew (base) --
  # Casks/masApps/taps are host-specific (see darwin-desktop.nix). zap cleanup
  # means the server's first switch removes the mini's old desktop casks.
  homebrew = {
    enable = true;
    onActivation.cleanup = "zap";
    brews = [
      "mole"
      "podman"
    ];
  };

  system.primaryUser = "connorads";

  # -- Networking & Firewall --
  networking.applicationFirewall = {
    enable = true;
    enableStealthMode = true;
    allowSigned = true;
    allowSignedApp = false;
  };

  # -- pf Firewall: Block External Access to Dev Server Ports --
  #
  # Problem: Many dev servers (Next.js, Vite, etc.) bind to 0.0.0.0 by default,
  # exposing your development environment to all devices on your local network.
  # This is a security risk - source maps, API keys in env vars, and debug
  # endpoints become accessible to anyone on your WiFi/LAN.
  #
  # Solution: Use macOS's pf (packet filter) to block incoming connections on
  # the WiFi/Ethernet interface (en0). Localhost still works because we only
  # block on en0, not lo0 (loopback).
  #
  # How it works:
  # - Creates /etc/pf.anchors/dev-firewall with blocking rules for en0
  # - LaunchDaemon loads rules on boot via pfctl
  # - Rules block incoming TCP on dev ports from external network only
  # - Loopback (localhost) is unaffected - rules only apply to en0
  #
  # To temporarily disable (e.g., for LAN testing):
  #   sudo pfctl -a 'com.apple/dev-firewall' -F rules
  #
  # To re-enable:
  #   sudo pfctl -a 'com.apple/dev-firewall' -f /etc/pf.anchors/dev-firewall
  #
  # Tailscale note: These rules block WiFi/Ethernet (en0) only. Tailscale uses
  # utun+ interfaces, so Tailscale peers CAN access dev ports by default.
  # If you want to block Tailscale too, use 'ts serve <port>' for explicit
  # sharing, or add: block return in on utun+ proto tcp from any to any port { ... }
  #
  environment.etc."pf.anchors/dev-firewall".text = ''
    # Block external access to common dev server ports on LAN interfaces
    # Localhost (lo0) and Tailscale (utun+) are unaffected
    # Ports: Next.js/React (3000-3003), Astro (4321), Vite (5173), Wrangler (8787)
    #
    # Blocked interfaces: en0 (Ethernet), en1 (WiFi/secondary)
    # macOS machines may have multiple en* interfaces - add more if needed
    dev_ports = "{ 3000, 3001, 3002, 3003, 4321, 5173, 8787 }"
    block return in on en0 proto tcp from any to any port $dev_ports
    block return in on en1 proto tcp from any to any port $dev_ports
  '';

  launchd.daemons.dev-firewall = {
    serviceConfig = {
      Label = "dev.pfctl.dev-firewall";
      ProgramArguments = [
        "/sbin/pfctl"
        "-a"
        "com.apple/dev-firewall"
        "-f"
        "/etc/pf.anchors/dev-firewall"
        "-E"
      ];
      RunAtLoad = true;
    };
  };

  # -- Nix Settings --
  nix.settings.experimental-features = "nix-command flakes";
  nix.settings.trusted-users = [
    "@admin"
    "connorads"
  ];

  # Linux builder VM for building aarch64-linux (e.g., Pi images).
  # Kept as a reference template — enable when cross-building.
  # Start manually when needed: sudo launchctl bootstrap system /Library/LaunchDaemons/org.nixos.linux-builder.plist
  nix.linux-builder = {
    enable = false;
    ephemeral = true;
    maxJobs = 4;
    config = {
      virtualisation = {
        darwin-builder = {
          diskSize = 40 * 1024;
          memorySize = 8 * 1024;
        };
        cores = 6;
      };
    };
  };

  # Automatic daily GC to keep the store tidy.
  nix.gc = {
    automatic = true;
    options = "--delete-older-than 14d";
    interval = {
      Hour = 3;
      Minute = 15;
    };
  };

  # Daily store optimization to deduplicate the store.
  nix.optimise = {
    automatic = true;
    interval = {
      Hour = 3;
      Minute = 30;
    };
  };

  # -- Programs --
  programs.zsh.enable = true;

  # -- Services --
  # enable = false actively disables Remote Login on every activation. Keeping
  # this block (not dropping to null/unmanaged) is what gives BOTH Macs the
  # "no native sshd" posture: the desktop never wants it, and the server reaches
  # in over Tailscale SSH (independent of this). The extraConfig is the intended
  # sshd_config should Remote Login ever be turned on manually.
  services.openssh = {
    enable = false;
    extraConfig = ''
      AuthorizedKeysCommand none
      AuthorizedKeysFile .ssh/authorized_keys
      AuthenticationMethods publickey
      PubkeyAuthentication yes
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      AllowUsers connorads
      AllowTcpForwarding no
      AllowAgentForwarding no
      X11Forwarding no
      MaxAuthTries 3
      LoginGraceTime 20s
    '';
  };

  # -- Tailscale (CLI, no GUI) --
  # Runs open-source `tailscaled` at boot (launchd daemon).
  #
  # NOTE: nix-darwin only runs its *recognised* activation hooks (preActivation,
  # extraActivation, postActivation). An arbitrarily-named
  # `system.activationScripts.tailscale` block is accepted by the module system
  # but never executed — so the firewall-stability copy below lives in the
  # daemon's own launch command, not an activation script.

  launchd.daemons.tailscaled = {
    serviceConfig = {
      Label = "com.tailscale.tailscaled";
      # Firewall-stable launch path:
      # The macOS Application Firewall remembers its "allow incoming connections"
      # verdict for *unsigned* binaries by FILE PATH (there's no code signature
      # to key on, so it falls back to the path). ${pkgs.tailscale} is a
      # content-addressed /nix/store path that changes on every Tailscale bump,
      # so each upgrade looked like a brand-new app and re-fired the firewall
      # prompt — leaving one stale "allow" entry per version. So at launch we
      # refresh a copy at a FIXED path and exec THAT: ALF then has a single
      # stable identity and stops re-prompting across upgrades. The launch
      # (store) path still changes in this plist each upgrade, which is what
      # makes launchd reload the daemon and re-copy the new binary — but ALF only
      # sees the exec'd stable path, so it stays quiet.
      #
      # We copy the inner `.tailscaled-wrapped` (the binary that opens the
      # socket; the `tailscaled` wrapper is just a bash shim adding lsof to PATH,
      # supplied via PATH below). A copy — not a sym/hardlink — is required: ALF
      # resolves links back to the real store path, and /nix is a separate APFS
      # volume so a hardlink can't cross to /usr/local anyway.
      ProgramArguments = [
        "/bin/sh"
        "-c"
        ''
          set -e
          mkdir -p /var/run/tailscale /var/lib/tailscale /usr/local/lib/tailscale
          cp -f ${pkgs.tailscale}/bin/.tailscaled-wrapped /usr/local/lib/tailscale/.tailscaled.new
          chmod 0755 /usr/local/lib/tailscale/.tailscaled.new
          mv -f /usr/local/lib/tailscale/.tailscaled.new /usr/local/lib/tailscale/tailscaled
          exec /usr/local/lib/tailscale/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock
        ''
      ];
      RunAtLoad = true;
      KeepAlive = true;
      StandardOutPath = "/var/log/tailscaled.log";
      StandardErrorPath = "/var/log/tailscaled.err.log";
      # tailscaled shells out to `lsof`; supply the system one (/usr/sbin/lsof)
      # since launching the unwrapped binary bypasses the nix wrapper's PATH.
      EnvironmentVariables = {
        PATH = "/usr/sbin:/usr/bin:/bin:/sbin";
      };
    };
  };

  # MagicDNS resolver (OSS tailscaled doesn't create this automatically).
  # See: https://github.com/tailscale/tailscale/issues/13461
  #
  # Default priority (1000). The host modules contribute further postActivation
  # text around this one via lib.mkBefore (desktop Spotlight, sorts first) and
  # lib.mkAfter (server pmset, sorts last). Custom-named activation keys are
  # accepted but NEVER executed, so everything must hang off postActivation.text.
  system.activationScripts.postActivation.text = ''
    if ${pkgs.tailscale}/bin/tailscale --socket /var/run/tailscale/tailscaled.sock status --json 2>/dev/null | ${pkgs.jq}/bin/jq -e '.CurrentTailnet.MagicDNSSuffix' >/dev/null 2>&1; then
      DOMAIN=$(${pkgs.tailscale}/bin/tailscale --socket /var/run/tailscale/tailscaled.sock status --json | ${pkgs.jq}/bin/jq -r '.CurrentTailnet.MagicDNSSuffix')
      mkdir -p /etc/resolver
      echo "nameserver 100.100.100.100" > "/etc/resolver/$DOMAIN"
      echo "Created /etc/resolver/$DOMAIN for Tailscale MagicDNS"
    else
      echo "Tailscale not running, skipping MagicDNS resolver setup"
    fi
  '';

  # -- Users & Home Manager (base) --
  # Scalars (username/homeDirectory/stateVersion) and the shared profile import
  # live here exactly once. Host modules merge in home.packages and host-only
  # home settings (defaultAppAssociations, credential helper, ...).
  users.users.connorads.home = "/Users/connorads";
  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    backupFileExtension = "bak";
    users.connorads = {
      imports = [ ./home-shared.nix ];
      home.username = "connorads";
      home.homeDirectory = "/Users/connorads";
      home.stateVersion = "24.11";
    };
  };

  # Set Git commit hash for darwin-version.
  system.configurationRevision = self.rev or self.dirtyRev or null;

  # Used for backwards compatibility, please read the changelog before changing.
  # $ darwin-rebuild changelog
  system.stateVersion = 5;

  # The platform the configuration will be used on.
  nixpkgs.hostPlatform = "aarch64-darwin";

  # Allow unfree packages (like VS Code)
  nixpkgs.config.allowUnfree = true;
}
