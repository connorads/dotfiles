{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs }:
  let
    configuration = { pkgs, ... }: {
      # List packages installed in system profile. To search by name, run:
      # $ nix-env -qaP | grep wget
      environment.systemPackages =
        [ pkgs.vim 
          pkgs.google-chrome
          pkgs.raycast
          pkgs.pam_u2f
          pkgs.rectangle
          pkgs.kitty
        ];
      
      homebrew = {
        enable = true;
        taps = [];
        # TODO can we use nix pkgs for these?
        brews = [
          "antigen"
          "mise"
        ];
        casks = [
          "sublime-text"
          "sublime-merge"
          "bitwarden"
          "chatgpt"
          "obsidian"
          "whatsapp"
          "steam"
        ];
      };

      system.activationScripts.pamU2F = ''
        mkdir -p /etc/local/lib/security
        ln -sf ${pkgs.libfido2}/lib/security/pam_u2f.so /etc/local/lib/security/pam_u2f.so
      '';

      system.activationScripts.postUserActivation.text = ''
        # Following line should allow us to avoid a logout/login cycle when changing settings
        /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
      '';

      system.defaults = {
        dock = {
          autohide = true;
        };
        controlcenter = {
          Sound = true;
          Bluetooth = true;
        };
        NSGlobalDomain = {
          "com.apple.swipescrolldirection" = false;
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

      # Allow touch ID from sudo
      security.pam.enableSudoTouchIdAuth = true;

      # Necessary for using flakes on this system.
      nix.settings.experimental-features = "nix-command flakes";

      # Enable alternative shell support in nix-darwin.
      # programs.fish.enable = true;

      # Set Git commit hash for darwin-version.
      system.configurationRevision = self.rev or self.dirtyRev or null;

      # Used for backwards compatibility, please read the changelog before changing.
      # $ darwin-rebuild changelog
      system.stateVersion = 5;

      # The platform the configuration will be used on.
      nixpkgs.hostPlatform = "aarch64-darwin";
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
