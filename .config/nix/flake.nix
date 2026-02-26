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
      # Apply overlays to a pkgs set
      mkPkgs =
        system:
        import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          # Temporary workarounds for upstream nixpkgs-unstable regressions.
          # TODO: after each `nfu`, check if the linked issue is closed and delete the block.
          # Once all three are gone, delete the entire `overlays = [ ... ];` argument too.
          overlays = [
            (final: prev: {
              pythonPackagesExtensions = prev.pythonPackagesExtensions ++ [
                (pyFinal: pyPrev: {
                  # TODO: remove once https://github.com/NixOS/nixpkgs/issues/494024 is fixed
                  # (gradio relaxes tomlkit upper bound; opened 2026-02-25)
                  gradio =
                    let orig = pyPrev.gradio;
                    in orig.overridePythonAttrs (old: {
                      pythonRelaxDeps = (old.pythonRelaxDeps or [ ]) ++ [ "tomlkit" ];
                      doCheck = false; # tests need CUDA + network, unavailable in sandbox
                    }) // { inherit (orig) override; }; # preserve override for passthru.tests self-ref

                  # TODO: remove once https://github.com/NixOS/nixpkgs/pull/493003 is merged
                  # (asyncer declares sniffio as runtime dep; opened 2026-02-22)
                  asyncer = pyPrev.asyncer.overridePythonAttrs (old: {
                    dependencies = (old.dependencies or [ ]) ++ [ pyFinal.sniffio ];
                  });

                  # TODO: remove once https://github.com/NixOS/nixpkgs/issues/493775 is fixed
                  # (jeepney skips D-Bus installCheck on darwin; opened 2026-02-24)
                  jeepney = pyPrev.jeepney.overrideAttrs (_: {
                    doInstallCheck = false; # dbus-run-session unavailable on darwin
                    # jeepney.io.trio needs outcome (trio dep), but trio support is optional
                    pythonImportsCheck = [
                      "jeepney"
                      "jeepney.auth"
                      "jeepney.io"
                      "jeepney.io.asyncio"
                      "jeepney.io.blocking"
                      "jeepney.io.threading"
                    ];
                  });
                })
              ];
            })
          ];
        };

      # Helper to create packages module for a given pkgs
      mkPackages = pkgs: import ./modules/packages.nix { inherit pkgs; };
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
        specialArgs = {
          inherit self;
          packages = mkPackages (mkPkgs "aarch64-darwin");
        };
        modules = [
          ./modules/darwin.nix
          home-manager.darwinModules.home-manager
        ];
      };

      # Linux: home-manager switch --flake ~/.config/nix (alias: hms)
      homeConfigurations."connor@penguin" =
        let
          pkgs = mkPkgs "x86_64-linux";
        in
        home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          extraSpecialArgs = {
            packages = mkPackages pkgs;
          };
          modules = [
            ./modules/linux-base.nix
            ./modules/linux-tailscale.nix
            ./modules/linux-packages.nix
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

      homeConfigurations."connor@dev" =
        let
          pkgs = mkPkgs "aarch64-linux";
        in
        home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          extraSpecialArgs = {
            packages = mkPackages pkgs;
          };
          modules = [
            ./modules/linux-base.nix
            ./modules/linux-packages.nix
          ];
        };

      homeConfigurations."codespace" =
        let
          pkgs = mkPkgs "x86_64-linux";
        in
        home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          extraSpecialArgs = {
            packages = mkPackages pkgs;
          };
          modules = [
            ./modules/linux-base.nix
            ./modules/linux-codespaces.nix
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
