# ==============================================================================
# macOS (nix-darwin) Configuration
# ==============================================================================
{
  self,
  pkgs,
  packages,
  ...
}:
{
  # -- System Packages --
  environment.systemPackages = [
    # Tools
    pkgs.pam_u2f
    pkgs.docker
    pkgs.colima
    pkgs.tart
    pkgs.tailscale
    # GUI Apps
    pkgs.raycast
    pkgs.rectangle
    pkgs.iina
  ];

  environment.variables = {
    EDITOR = "micro";
    VISUAL = "micro";
  };

  # -- Fonts --
  fonts.packages = with pkgs; [
    fira-code
    nerd-fonts.fira-code
  ];

  # -- Homebrew --
  homebrew = {
    enable = true;
    onActivation.cleanup = "zap";
    taps = [ ];
    brews = [
      "mole"
    ];
    casks = [
      # Apps
      "kitty"
      "sublime-text"
      "sublime-merge"
      "bitwarden"
      "chatgpt"
      "claude"
      "codex-app"
      "comfyui"
      "gimp"
      "lm-studio"
      "obsidian"
      "whatsapp"
      "steam"
      "whisky"
      "android-studio"
      "android-commandlinetools"
      "visual-studio-code"
      "visual-studio-code@insiders"
      "cursor"
      "kiro"
      "antigravity"
      "zed"
      "zappy"
      "calibre"
      "onedrive"
      "macwhisper"
      "native-access"
      "google-chrome"
      "firefox"
      "tor-browser"
      "discord"
      "zoom"
      "cyberduck"
      "handbrake-app"
      "libreoffice"
      "balenaetcher"
      "raspberry-pi-imager"
      "notion"
      "virtual-desktop-streamer"
      "keka"
      "figma"
      "opencode-desktop"
      "conductor"
      "knockknock"
      "slack"

      # Hardware
      "logitech-camera-settings"
      "wacom-tablet"
    ];
    masApps = {
      RunCat = 1429033973;
      Perplexity = 6714467650;
    };
  };

  system.primaryUser = "connorads";

  # -- System Defaults (macOS preferences) --
  system.defaults = {
    dock = {
      autohide = true;
      show-recents = false;
      persistent-apps = [
        "/Applications/kitty.app"
        "/Applications/Google Chrome.app"
        "/Applications/Visual Studio Code.app"
        "/Applications/Steam.app"
        "/Applications/Sublime Merge.app"
        "/Applications/Sublime Text.app"
      ];
    };
    finder = {
      _FXShowPosixPathInTitle = true;
      AppleShowAllExtensions = true;
      QuitMenuItem = true;
      ShowPathbar = true;
      ShowStatusBar = true;
      FXPreferredViewStyle = "clmv"; # Column view
      FXDefaultSearchScope = "SCcf"; # Search current folder by default
    };
    controlcenter = {
      Sound = true;
      Bluetooth = true;
      FocusModes = true;
    };
    menuExtraClock = {
      ShowSeconds = true;
      Show24Hour = true;
    };
    NSGlobalDomain = {
      "com.apple.swipescrolldirection" = false;
      AppleInterfaceStyle = "Dark";
    };
    CustomUserPreferences = {
      "com.apple.symbolichotkeys" = {
        AppleSymbolicHotKeys = {
          # Disable 'Cmd + Space' for Spotlight Search
          "64" = {
            enabled = false;
          };
          # Disable 'Cmd + Alt + Space' for Finder search window
          "65" = {
            enabled = false;
          };
        };
      };

      # Finder > Settings > Advanced > "Remove items from the Trash after 30 days"
      "com.apple.finder" = {
        FXRemoveOldTrashItems = true;
      };
    };
  };

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
    # Mac Mini has multiple en* interfaces - add more if needed
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

  # -- PAM / sudo authentication --
  # TouchID and YubiKey for sudo
  environment.etc."pam.d/sudo_local".text = ''
    auth sufficient pam_tid.so
    auth sufficient ${pkgs.pam_u2f}/lib/security/pam_u2f.so cue
  '';

  # -- Nix Settings --
  nix.settings.experimental-features = "nix-command flakes";
  nix.settings.trusted-users = [
    "@admin"
    "connorads"
  ];

  # Linux builder VM for building aarch64-linux (e.g., Pi images)
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
  services.openssh = {
    enable = true;
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
  system.activationScripts.tailscale = {
    text = ''
      mkdir -p /var/lib/tailscale
      chown root:wheel /var/lib/tailscale || true
      chmod 700 /var/lib/tailscale || true
    '';
  };

  launchd.daemons.tailscaled = {
    serviceConfig = {
      Label = "com.tailscale.tailscaled";
      ProgramArguments = [
        "/bin/sh"
        "-lc"
        "mkdir -p /var/run/tailscale /var/lib/tailscale && exec ${pkgs.tailscale}/bin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock"
      ];
      RunAtLoad = true;
      KeepAlive = true;
      StandardOutPath = "/var/log/tailscaled.log";
      StandardErrorPath = "/var/log/tailscaled.err.log";
    };
  };

  # MagicDNS resolver (OSS tailscaled doesn't create this automatically)
  # See: https://github.com/tailscale/tailscale/issues/13461
  # Dynamically creates /etc/resolver/<tailnet> at activation time
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

  # -- Users & Home Manager --
  users.users.connorads.home = "/Users/connorads";
  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    users.connorads =
      { lib, ... }:
      {
        imports = [ ./home-shared.nix ];
        home.username = "connorads";
        home.homeDirectory = "/Users/connorads";
        home.packages = packages.sharedPackages ++ [ pkgs.duti ];
        home.stateVersion = "24.11";

        # Keep editor file associations declarative without replacing the full
        # LaunchServices LSHandlers array: duti updates only the targeted types.
        home.activation.defaultAppAssociations = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          app_id="com.sublimetext.4"

          for ext in md markdown mdown mkd txt json yaml yml toml env; do
            ${pkgs.duti}/bin/duti -s "$app_id" "$ext" all
          done

          for uti in net.daringfireball.markdown public.plain-text public.json public.yaml; do
            ${pkgs.duti}/bin/duti -s "$app_id" "$uti" all
          done
        '';

        # macOS-specific: use Keychain for git credentials
        programs.git.settings.credential.helper = "osxkeychain";
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
