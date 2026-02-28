# ==============================================================================
# connorads Nix Configuration
# ==============================================================================
#
# Configurations:
#   - darwinConfigurations."Connors-Mac-mini"  : macOS (nix-darwin + home-manager)
#   - homeConfigurations."connor@penguin"      : Chromebook Linux container (x86_64)
#   - homeConfigurations."connor@dev"          : Remote/cloud dev machine (aarch64)
#   - homeConfigurations."codespace"           : GitHub Codespaces (minimal)
#
# RPi5 config: github.com/connorads/rpi5 (system) + homeConfigurations."connor@rpi5" (user env)
#
# Rebuild commands:
#   macOS:  darwin-rebuild switch --flake ~/.config/nix  (alias: drs)
#   Linux:  home-manager switch --flake ~/.config/nix    (alias: hms)
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
  };

  outputs =
    inputs@{
      self,
      nix-darwin,
      nixpkgs,
      home-manager,
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
          # Once both are gone, delete the entire `overlays = [ ... ];` argument too.
          overlays = [
            (final: prev: {
              pythonPackagesExtensions = prev.pythonPackagesExtensions ++ [
                (pyFinal: pyPrev: {
                  # TODO: remove once https://github.com/NixOS/nixpkgs/issues/494024 is fixed
                  # (gradio relaxes tomlkit upper bound; opened 2026-02-25)
                  gradio =
                    let
                      orig = pyPrev.gradio;
                    in
                    orig.overridePythonAttrs (old: {
                      pythonRelaxDeps = (old.pythonRelaxDeps or [ ]) ++ [ "tomlkit" ];
                      doCheck = false; # tests need CUDA + network, unavailable in sandbox
                    })
                    // {
                      inherit (orig) override;
                    }; # preserve override for passthru.tests self-ref

                  # TODO: remove once https://github.com/NixOS/nixpkgs/pull/493003 is merged
                  # (asyncer declares sniffio as runtime dep; opened 2026-02-22)
                  asyncer = pyPrev.asyncer.overridePythonAttrs (old: {
                    dependencies = (old.dependencies or [ ]) ++ [ pyFinal.sniffio ];
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
      formatter = nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ] (
        system: nixpkgs.legacyPackages.${system}.nixfmt
      );

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
            ./modules/linux-crostini.nix
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

      # RPi5 user env: home-manager switch --flake ~/.config/nix (alias: hms)
      homeConfigurations."connor@rpi5" =
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
            (
              { packages, ... }:
              {
                home.packages = packages.serverPackages;
              }
            )
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

    };
}
