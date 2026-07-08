# ==============================================================================
# connorads Nix Configuration
# ==============================================================================
#
# Configurations:
#   - darwinConfigurations."Connors-MacBook-Air"  : macOS desktop workstation (nix-darwin + home-manager)
#   - darwinConfigurations."Connors-Mac-mini"     : macOS headless Tailscale-only dev server (nix-darwin + home-manager)
#   - homeConfigurations."connor@penguin"         : Chromebook Linux container (x86_64)
#   - homeConfigurations."connor@dev"             : Remote/cloud dev machine (x86_64; aarch64 variant: connor@dev-aarch64-linux)
#   - homeConfigurations."codespace"              : GitHub Codespaces (minimal)
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
          overlays = [
            # Patched tmux: dims inactive pane *content* (lazygit, nvim syntax,
            # any ANSI-coloured output). Vanilla tmux's `window-style` /
            # `window-active-style` only retint cells that use the terminal
            # *default* fg/bg — anything emitting explicit SGR colours bypasses
            # them, so inactive panes stay at full saturation and focus cues
            # get lost. The patch hooks `tty_attributes` to blend every cell
            # toward the pane bg (Rec. 601 luma desat + target blend).
            #
            # Dimming needs two patches:
            #   - dim-inactive-panes.patch — the dimming itself
            #   - force-redraw-on-focus-change.patch — without it panes don't
            #     re-render on focus change, so dim/undim stalls until next
            #     keypress. The name doesn't telegraph this; do not drop it.
            # split-status-top-bottom.patch is a separate local experiment for
            # top window row + bottom stats row, gated by a tmux user option.
            #
            # See ./patches/README.md for lineage and bump procedure.
            (final: prev: {
              redress = prev.callPackage ./packages/redress.nix { };

              tmux = prev.tmux.overrideAttrs (old: {
                patches = (old.patches or [ ]) ++ [
                  ./patches/dim-inactive-panes.patch
                  ./patches/force-redraw-on-focus-change.patch
                  ./patches/split-status-top-bottom.patch
                ];
              });
            })
          ];
        };

      # Helper to create packages module for a given pkgs
      mkPackages = pkgs: import ./modules/packages.nix { inherit pkgs; };

      # Helper to reduce darwinConfiguration boilerplate
      mkDarwin =
        extraModules:
        nix-darwin.lib.darwinSystem {
          specialArgs = {
            inherit self;
            packages = mkPackages (mkPkgs "aarch64-darwin");
          };
          modules = [
            ./modules/darwin-shared.nix
            home-manager.darwinModules.home-manager
          ]
          ++ extraModules;
        };

      # Helper to reduce homeConfiguration boilerplate
      mkHome =
        system: modules:
        let
          pkgs = mkPkgs system;
        in
        home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          extraSpecialArgs = {
            packages = mkPackages pkgs;
          };
          inherit modules;
        };

      # dev (remote/cloud) box modules — identical on either arch. Historically
      # ARM (cax*), but x86 (cx*) when Hetzner ARM stock is short, so the config
      # must build on both. Bare `connor@dev` tracks the live box; the
      # arch-qualified variants keep either arch first-class (flake check + a
      # concrete `#connor@dev-<system>` target when the hostname's arch differs).
      devModules = [
        ./modules/linux-base.nix
        ./modules/linux-packages.nix
        # The dev box has no GitHub SSH private key (login keys only); it auths to
        # GitHub via the gh-gate PAT over HTTPS. Override the shared ssh default so
        # `gh repo clone` / ghcl clone over HTTPS with the token instead of SSH.
        ({ lib, ... }: { programs.gh.settings.git_protocol = lib.mkForce "https"; })
      ];
    in
    # ==========================================================================
    # Flake Outputs
    # ==========================================================================
    {
      formatter = nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ] (
        system: nixpkgs.legacyPackages.${system}.nixfmt
      );

      # macOS: darwin-rebuild switch --flake ~/.config/nix (alias: drs)
      # Air = desktop workstation; mini = headless Tailscale-only dev server.
      darwinConfigurations."Connors-MacBook-Air" = mkDarwin [
        ./modules/darwin-desktop.nix
        { homebrew.casks = [ "logitech-camera-settings" ]; }
      ];
      darwinConfigurations."Connors-Mac-mini" = mkDarwin [
        ./modules/darwin-server.nix
      ];

      # Linux: home-manager switch --flake ~/.config/nix (alias: hms)
      homeConfigurations."connor@penguin" = mkHome "x86_64-linux" [
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

      # Bare name resolves for install.sh / `hms` (hostname carries no arch);
      # points at the live box's arch. Both arch variants are always buildable.
      homeConfigurations."connor@dev" = mkHome "x86_64-linux" devModules;
      homeConfigurations."connor@dev-aarch64-linux" = mkHome "aarch64-linux" devModules;
      homeConfigurations."connor@dev-x86_64-linux" = mkHome "x86_64-linux" devModules;

      # RPi5 user env: home-manager switch --flake ~/.config/nix (alias: hms)
      homeConfigurations."connor@rpi5" = mkHome "aarch64-linux" [
        ./modules/linux-base.nix
        (
          { packages, ... }:
          {
            home.packages = packages.serverPackages;
          }
        )
      ];

      homeConfigurations."codespace" = mkHome "x86_64-linux" [
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

      # Force-evaluate every configuration to catch typos and broken imports
      # without a full rebuild: nix flake check --flake ~/.config/nix
      # Derived from the config sets so adding a host can't silently escape the
      # check: darwinConfigurations contribute their .system, homeConfigurations
      # their .activationPackage, each bucketed under the derivation's platform.
      checks =
        let
          builds =
            (nixpkgs.lib.mapAttrs (_name: cfg: cfg.system) self.darwinConfigurations)
            // (nixpkgs.lib.mapAttrs (_name: cfg: cfg.activationPackage) self.homeConfigurations);
        in
        nixpkgs.lib.foldlAttrs (
          acc: name: drv:
          nixpkgs.lib.recursiveUpdate acc { ${drv.system}.${name} = drv; }
        ) { } builds;

    };
}
