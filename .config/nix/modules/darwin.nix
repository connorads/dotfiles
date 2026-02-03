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
      "comfyui"
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
      { ... }:
      {
        imports = [ ./home-shared.nix ];
        home.username = "connorads";
        home.homeDirectory = "/Users/connorads";
        home.packages = packages.sharedPackages;
        home.stateVersion = "24.11";

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
