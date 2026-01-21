# ==============================================================================
# connorads Nix Configuration
# ==============================================================================
#
# Configurations:
#   - darwinConfigurations."Connors-Mac-mini"  : macOS (nix-darwin + home-manager)
#   - homeConfigurations."connor@penguin"      : Chromebook Linux container (x86_64)
#   - homeConfigurations."connor@dev"          : Remote/cloud dev machine (aarch64)
#   - homeConfigurations."codespace"           : GitHub Codespaces (minimal)
#   - nixosConfigurations."rpi5"               : Raspberry Pi 5 (NixOS)
#   - installerImages.rpi5                     : Pi 5 installer (SSH keys baked in)
#
# Rebuild commands:
#   macOS:  darwin-rebuild switch --flake ~/.config/nix  (alias: drs)
#   Linux:  home-manager switch --flake ~/.config/nix    (alias: hms)
#   NixOS:  nixos-rebuild switch --flake ~/.config/nix   (alias: nrs)
#
# Build Pi installer: nix build .#installerImages.rpi5
#
# ==============================================================================

{
  description = "connorads nix configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin.url = "github:nix-darwin/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    nixos-raspberrypi.url = "github:nvmd/nixos-raspberrypi/main";
  };

  outputs =
    inputs@{
      self,
      nix-darwin,
      nixpkgs,
      home-manager,
      nixos-raspberrypi,
    }:
    let
      # ========================================================================
      # Shared Packages (cross-platform: macOS and Linux)
      # ========================================================================
      sharedPackages =
        pkgs: with pkgs; [
          # Shell & terminal
          zsh
          antigen
          tmux
          kitty.terminfo

          # Text editors
          vim
          micro

          # File navigation & search
          fd
          ripgrep
          fzf
          zoxide
          tree
          yazi
          eza

          # Git & version control
          delta
          lazygit
          lazyworktree
          jujutsu

          # Dev tools
          mise
          pipx
          nixfmt
          jq
          gum
          usql
          postgresql
          lazysql
          witr

          # System utilities
          coreutils
          bc
          bat
          dust
          ncdu
          parallel-disk-usage
          zstd

          # Networking & security
          tailscale
          nmap
          rustscan
          wgcf
          wireproxy
          cloudflared

          # Media & presentation
          yt-dlp
          presenterm
          charm-freeze

          # Sync & backup
          rclone
          unison

          # Apps
          telegram-desktop
        ];

      # Core packages for minimal environments (codespaces, containers)
      corePackages =
        pkgs: with pkgs; [
          zsh
          tmux
          kitty.terminfo
          vim
          micro
          fd
          ripgrep
          fzf
          zoxide
          tree
          eza
          bat
          delta
          jq
          coreutils
          tailscale
          mise
        ];

      # ========================================================================
      # Shared Home-Manager Configuration
      # ========================================================================
      sharedHomeConfiguration = {
        manual = {
          html.enable = false;
          manpages.enable = false;
          json.enable = false;
        };

        programs.git = {
          enable = true;
          lfs.enable = true;
          settings = {
            user.name = "Connor Adams";
            user.email = "connorads@users.noreply.github.com";
            init.defaultBranch = "main";
            push.autoSetupRemote = true;
          };
        };

        programs.neovim.enable = true;

        home.sessionVariables = {
          EDITOR = "micro";
          VISUAL = "micro";
        };
      };

      # ========================================================================
      # macOS (nix-darwin) Configuration
      # ========================================================================
      darwinConfiguration =
        { pkgs, ... }:
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
          fonts.packages = with pkgs; [ fira-code ];

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
          nix.linux-builder = {
            enable = true;
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
          programs = {
            zsh = {
              enable = true;
              interactiveShellInit = ''
                source ${pkgs.antigen}/share/antigen/antigen.zsh
              '';
            };
          };

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
            users.connorads = sharedHomeConfiguration // {
              home.username = "connorads";
              home.homeDirectory = "/Users/connorads";
              home.packages = sharedPackages pkgs;
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

          # Allow unfree packages (like VS Code )
          nixpkgs.config.allowUnfree = true;
        };

      # ========================================================================
      # Linux Home-Manager Configuration
      # ========================================================================
      linuxHomeBaseConfiguration =
        { pkgs, ... }:
        sharedHomeConfiguration
        // {
          home.username = "connor";
          home.homeDirectory = "/home/connor";
          home.stateVersion = "24.11";

          news.display = "silent";

          # Enable Nix PATH and environment for non-NixOS Linux
          targets.genericLinux.enable = true;

          # Let Home Manager manage itself
          programs.home-manager.enable = true;

          # SSH agent setup
          programs.ssh = {
            enable = true;
            enableDefaultConfig = false;
            includes = [ "config.original" ]; # Preserve existing SSH config
            matchBlocks."*".addKeysToAgent = "yes";
          };

          home.sessionVariables = sharedHomeConfiguration.home.sessionVariables;

          # Allow unfree packages
          nixpkgs.config.allowUnfree = true;
        };

      linuxTailscaleUserspaceConfiguration =
        { pkgs, ... }:
        {
          systemd.user.services.tailscaled = {
            Unit = {
              Description = "Tailscale (userspace)";
              Wants = [ "network-online.target" ];
              After = [ "network-online.target" ];
            };

            Service = {
              ExecStart = "${pkgs.tailscale}/bin/tailscaled --tun=userspace-networking --state=%S/tailscale/tailscaled.state --socket=%t/tailscale/tailscaled.sock";
              Restart = "on-failure";
              RestartSec = 5;
              RuntimeDirectory = "tailscale";
              StateDirectory = "tailscale";
            };

            Install = {
              WantedBy = [ "default.target" ];
            };
          };
        };

      linuxHomePackagesConfiguration =

        { pkgs, ... }:
        let
          # VS Code override: nixpkgs often lags the latest release.
          # Update version/rev/hashes when a new release is needed.
          vscodeOverride = pkgs.vscode.overrideAttrs (
            _old:
            let
              version = "1.108.0";
              rev = "94e8ae2b28cb5cc932b86e1070569c4463565c37";
            in
            {
              inherit version rev;
              src = pkgs.fetchurl {
                name = "VSCode_${version}_linux-x64.tar.gz";
                url = "https://update.code.visualstudio.com/${version}/linux-x64/stable";
                hash = "sha256-20ydDfHFhy3BNxC9bHG1JTgybFY9zxxc81EApOVh3wk=";
              };
              vscodeServer = pkgs.srcOnly {
                name = "vscode-server-${rev}.tar.gz";
                src = pkgs.fetchurl {
                  name = "vscode-server-${rev}.tar.gz";
                  url = "https://update.code.visualstudio.com/commit:${rev}/server-linux-x64/stable";
                  hash = "sha256-VvwZaE1T5FTh/KJdLj9Br51VBMcYcyh4SgZILLS5hwQ=";
                };
                stdenv = pkgs.stdenvNoCC;
              };
            }
          );
        in
        {
          # Apps we want to install on Linux but not on macOS
          home.packages = sharedPackages pkgs ++ [
            vscodeOverride
            pkgs.libnotify
          ];
        };

      linuxCodespacesPackagesConfiguration =
        { pkgs, ... }:
        {
          # Minimal package set for ephemeral environments (git provided by programs.git)
          home.packages = corePackages pkgs;
        };

    in
    # ==========================================================================
    # Flake Outputs
    # ==========================================================================
    {
      formatter.aarch64-darwin = nixpkgs.legacyPackages.aarch64-darwin.nixfmt;
      formatter.x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.nixfmt;
      formatter.aarch64-linux = nixpkgs.legacyPackages.aarch64-linux.nixfmt;

      # macOS: darwin-rebuild switch --flake ~/.config/nix (alias: drs)
      darwinConfigurations."Connors-Mac-mini" = nix-darwin.lib.darwinSystem {
        modules = [
          darwinConfiguration
          home-manager.darwinModules.home-manager
        ];
      };

      # Linux: home-manager switch --flake ~/.config/nix (alias: hms)
      homeConfigurations."connor@penguin" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [
          linuxHomeBaseConfiguration
          linuxTailscaleUserspaceConfiguration
          linuxHomePackagesConfiguration
          # Crostini desktop integration: expose Nix apps to Chrome OS launcher
          (
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
          )
          (
            { ... }:
            {
              services.ssh-agent.enable = true;
              home.sessionVariables.SSH_AUTH_SOCK = "$XDG_RUNTIME_DIR/ssh-agent";
            }
          )
        ];
      };

      homeConfigurations."connor@dev" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.aarch64-linux;
        modules = [
          linuxHomeBaseConfiguration
          linuxTailscaleUserspaceConfiguration
          linuxHomePackagesConfiguration
        ];
      };

      homeConfigurations."codespace" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [
          linuxHomeBaseConfiguration
          linuxCodespacesPackagesConfiguration
          (
            { lib, ... }:
            {
              home.username = lib.mkForce "codespace";
              home.homeDirectory = lib.mkForce "/home/codespace";
            }
          )
        ];
      };

      # Raspberry Pi 5: nixos-rebuild switch --flake ~/.config/nix#rpi5
      nixosConfigurations."rpi5" = nixos-raspberrypi.lib.nixosSystem {
        specialArgs = {
          inherit inputs nixos-raspberrypi;
        };
        modules = [
          (
            { ... }:
            {
              imports = with nixos-raspberrypi.nixosModules; [
                raspberry-pi-5.base
                raspberry-pi-5.bluetooth
              ];
            }
          )
          home-manager.nixosModules.home-manager
          ./hosts/rpi5/configuration.nix
        ];
      };

      # Pi 5 installer image with SSH keys baked in (no HDMI needed)
      # Build: nix build .#installerImages.rpi5
      installerImages.rpi5 =
        let
          installer = nixos-raspberrypi.lib.nixosInstaller {
            specialArgs = {
              inherit inputs nixos-raspberrypi;
            };
            modules = [
              (
                { ... }:
                {
                  imports = with nixos-raspberrypi.nixosModules; [
                    raspberry-pi-5.base
                    raspberry-pi-5.page-size-16k
                  ];
                }
              )
              (
                { ... }:
                let
                  githubKeys = builtins.fetchurl {
                    url = "https://github.com/connorads.keys";
                    sha256 = "1alzqm1lijavww9rlrj7dy876jy50dfx0v3f4a813kyxz1273yi1";
                  };
                  keys = builtins.filter (k: builtins.isString k && k != "") (
                    builtins.split "\n" (builtins.readFile githubKeys)
                  );
                in
                {
                  users.users.nixos.openssh.authorizedKeys.keys = keys;
                  users.users.root.openssh.authorizedKeys.keys = keys;
                }
              )
            ];
          };
        in
        installer.config.system.build.sdImage;
    };
}
