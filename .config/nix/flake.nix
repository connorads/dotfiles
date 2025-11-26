{
  description = "connorads nix configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      self,
      nix-darwin,
      nixpkgs,
    }:
    let
      configuration =
        { pkgs, ... }:
        {
          environment.systemPackages = [
            # Tools
            pkgs.mise
            pkgs.antigen
            pkgs.vim
            pkgs.tmux
            pkgs.pipx
            pkgs.nixfmt-rfc-style
            pkgs.pam_u2f
            pkgs.docker
            pkgs.colima
            pkgs.tree
            pkgs.tart
            pkgs.yt-dlp
            pkgs.ncdu
            pkgs.nmap
            pkgs.rustscan
            pkgs.wgcf
            pkgs.wireproxy
            pkgs.coreutils
            pkgs.cloudflared
            pkgs.presenterm
            pkgs.rclone
            pkgs.ripgrep

            # Apps
            pkgs.raycast
            pkgs.rectangle
            pkgs.iina
          ];

          fonts.packages = with pkgs; [ fira-code ];

          homebrew = {
            enable = true;
            onActivation.cleanup = "zap";
            taps = [ ];
            brews = [ ];
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

          # Use TouchId and yubikey for sudo
          environment.etc = {
            "pam.d/sudo_local".text = ''
              auth sufficient pam_tid.so
              auth sufficient ${pkgs.pam_u2f}/lib/security/pam_u2f.so cue
            '';
          };

          # Necessary for using flakes on this system.
          nix.settings.experimental-features = "nix-command flakes";

          programs = {
            zsh = {
              enable = true;
              shellInit = ''
                source ${pkgs.antigen}/share/antigen/antigen.zsh
              '';
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
    in
    {
      # Build darwin flake using:
      # $ darwin-rebuild build --flake .#Connors-Mac-mini
      darwinConfigurations."Connors-Mac-mini" = nix-darwin.lib.darwinSystem {
        modules = [ configuration ];
      };
    };
}
