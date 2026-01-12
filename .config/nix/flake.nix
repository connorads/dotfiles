{
  description = "connorads nix configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin.url = "github:nix-darwin/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      self,
      nix-darwin,
      nixpkgs,
      home-manager,
    }:
    let
      # Cross-platform packages (work on both macOS and Linux)
      sharedPackages =
        pkgs: with pkgs; [
          # Terminal
          kitty.terminfo

          # Tools
          zsh
          mise
          antigen
          vim
          micro
          fd
          tmux
          pipx
          nixfmt
          zoxide
          tree
          fzf
          gum
          jq
          yt-dlp
          ncdu
          parallel-disk-usage
          nmap
          rustscan
          wgcf
          wireproxy
          coreutils
          cloudflared
          presenterm
          rclone
          ripgrep
          bat
          eza
          delta
          dust
          usql
          postgresql
          charm-freeze
          lazygit
          lazysql
          yazi
          jujutsu
          unison
          witr
          telegram-desktop
        ];

      # macOS-specific configuration
      darwinConfiguration =
        { pkgs, ... }:
        {
          # macOS-specific system packages
          environment.systemPackages = [
            # macOS-specific tools
            pkgs.pam_u2f
            pkgs.docker
            pkgs.colima
            pkgs.tart

            # macOS-specific apps
            pkgs.raycast
            pkgs.rectangle
            pkgs.iina
          ];

          fonts.packages = with pkgs; [ fira-code ];

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
              "tailscale-app"
              "knockknock"

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
            };
          };

          networking.applicationFirewall = {
            enable = true;
            enableStealthMode = true;
            allowSigned = true;
            allowSignedApp = false;
          };

          # Use TouchId and yubikey for sudo
          environment.etc."pam.d/sudo_local".text = ''
            auth sufficient pam_tid.so
            auth sufficient ${pkgs.pam_u2f}/lib/security/pam_u2f.so cue
          '';

          # Necessary for using flakes on this system.
          nix.settings.experimental-features = "nix-command flakes";

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

          programs = {
            zsh = {
              enable = true;
              interactiveShellInit = ''
                source ${pkgs.antigen}/share/antigen/antigen.zsh
              '';
            };
          };

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

          # User configuration - required for home-manager integration
          users.users.connorads.home = "/Users/connorads";

          # Home Manager integration for macOS
          home-manager = {
            useGlobalPkgs = true;
            useUserPackages = true;
            users.connorads = {
              home.username = "connorads";
              home.homeDirectory = "/Users/connorads";
              home.packages = sharedPackages pkgs;
              home.stateVersion = "24.11";

              manual = {
                html.enable = false;
                manpages.enable = false;
                json.enable = false;
              };

              # Git configuration
              programs.git = {
                enable = true;
                lfs.enable = true;
                settings = {
                  user.name = "Connor Adams";
                  user.email = "connorads@users.noreply.github.com";
                  init.defaultBranch = "main";
                  credential.helper = "osxkeychain";
                  push.autoSetupRemote = true;
                };
              };
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

      # Linux home-manager configuration
      linuxHomeBaseConfiguration =
        { pkgs, ... }:
        {
          home.username = "connor";
          home.homeDirectory = "/home/connor";
          home.stateVersion = "24.11";

          manual = {
            html.enable = false;
            manpages.enable = false;
            json.enable = false;
          };

          news.display = "silent";

          # Enable Nix PATH and environment for non-NixOS Linux
          targets.genericLinux.enable = true;

          # Let Home Manager manage itself
          programs.home-manager.enable = true;

          # Git configuration
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

          # SSH agent setup
          services.ssh-agent.enable = true;
          programs.ssh = {
            enable = true;
            enableDefaultConfig = false;
            # Preserve existing SSH config
            includes = [ "config.original" ];
            matchBlocks."*" = {
              addKeysToAgent = "yes";
            };
          };

          programs.neovim = {
            enable = true;
          };

          home.sessionVariables = {
            SSH_AUTH_SOCK = "$XDG_RUNTIME_DIR/ssh-agent";
            EDITOR = "micro";
            VISUAL = "micro";
          };

          # Allow unfree packages
          nixpkgs.config.allowUnfree = true;
        };

      linuxHomePackagesConfiguration =
        { pkgs, ... }:
        let
          vscodeOverride = pkgs.vscode.overrideAttrs (
            _old:
            let
              # Override while nixpkgs lags upstream VS Code releases.
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
          # Codespaces-lite profile
          home.packages = with pkgs; [
            kitty.terminfo
            zsh
            mise
            vim
            micro
            tmux
            git
            fd
            ripgrep
            bat
            eza
            delta
            fzf
            jq
            zoxide
            tree
            coreutils
          ];
        };

    in
    {
      formatter.aarch64-darwin = nixpkgs.legacyPackages.aarch64-darwin.nixfmt;
      formatter.x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.nixfmt;
      formatter.aarch64-linux = nixpkgs.legacyPackages.aarch64-linux.nixfmt;

      # Build darwin flake using:
      # $ darwin-rebuild switch --flake ~/.config/nix
      # alias: drs
      darwinConfigurations."Connors-Mac-mini" = nix-darwin.lib.darwinSystem {
        modules = [
          darwinConfiguration
          home-manager.darwinModules.home-manager
        ];
      };

      # Build home-manager flake using:
      # $ home-manager switch --flake ~/.config/nix
      # alias: hms
      homeConfigurations."connor@penguin" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [
          linuxHomeBaseConfiguration
          linuxHomePackagesConfiguration
        ];
      };

      homeConfigurations."connor@dev" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.aarch64-linux;
        modules = [
          linuxHomeBaseConfiguration
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
    };
}
