# Raspberry Pi 5 NixOS Configuration
# Rebuild: nixos-rebuild switch --flake ~/.config/nix#rpi5
{
  config,
  pkgs,
  lib,
  ...
}:

{
  system.stateVersion = "24.11";

  # ==========================================================================
  # Bootloader
  # ==========================================================================
  boot.loader.raspberryPi.bootloader = "kernel";

  # ==========================================================================
  # Networking
  # ==========================================================================
  networking = {
    hostName = "rpi5";
    useDHCP = lib.mkDefault true;
    firewall = {
      enable = true;
      allowedTCPPorts = [ 22 ]; # SSH open for local access
      trustedInterfaces = [ "tailscale0" ];
      allowedUDPPorts = [ config.services.tailscale.port ];
    };
  };

  time.timeZone = "Europe/London";

  # ==========================================================================
  # Nix Settings
  # ==========================================================================
  nix = {
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      trusted-users = [
        "root"
        "connor"
      ];
      # nixos-raspberrypi cache for kernel builds
      substituters = [ "https://nixos-raspberrypi.cachix.org" ];
      trusted-public-keys = [
        "nixos-raspberrypi.cachix.org-1:4iMO9LXa8BqhU+Rpg6LQKiGa2lsNh/j2oiYLNOQ5sPI="
      ];
    };

    gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 14d";
    };

    optimise = {
      automatic = true;
      dates = [ "weekly" ];
    };
  };

  # ==========================================================================
  # User
  # ==========================================================================
  security.sudo.wheelNeedsPassword = false;

  users.users.connor = {
    isNormalUser = true;
    shell = pkgs.zsh;
    extraGroups = [
      "wheel"
      "docker"
    ];
    # Fetch SSH keys from GitHub (update sha256 when keys change: nix-prefetch-url https://github.com/connorads.keys)
    openssh.authorizedKeys.keys =
      let
        githubKeys = builtins.fetchurl {
          url = "https://github.com/connorads.keys";
          sha256 = "1alzqm1lijavww9rlrj7dy876jy50dfx0v3f4a813kyxz1273yi1";
        };
        parts = builtins.split "\n" (builtins.readFile githubKeys);
      in
      builtins.filter (k: builtins.isString k && k != "") parts;
    linger = true; # Keep user services after logout (for Docker)
  };

  # ==========================================================================
  # SSH (key-only, local network access preserved)
  # ==========================================================================
  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "no";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PubkeyAuthentication = true;
      MaxAuthTries = 3;
      LoginGraceTime = 20;
    };
  };

  services.fail2ban = {
    enable = true;
    maxretry = 3;
    bantime = "1h";
  };

  # ==========================================================================
  # Tailscale (manual auth - ssh in, run: sudo tailscale up --ssh)
  # ==========================================================================
  services.tailscale.enable = true;

  # ==========================================================================
  # Docker (rootless)
  # ==========================================================================
  virtualisation.docker = {
    enable = false;
    rootless = {
      enable = true;
      setSocketVariable = true;
    };
  };
  security.unprivilegedUsernsClone = true;

  # ==========================================================================
  # Home Manager
  # ==========================================================================
  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    users.connor =
      { pkgs, ... }:
      {
        home.username = "connor";
        home.homeDirectory = "/home/connor";
        home.stateVersion = "24.11";
        home.enableNixpkgsReleaseCheck = false; # nixos-raspberrypi uses different nixpkgs

        programs.git = {
          enable = true;
          lfs.enable = true;
          settings = {
            user.name = "Connor Adams";
            user.email = "connorads@users.noreply.github.com";
            init.defaultBranch = "main";
          };
        };

        home.packages = with pkgs; [
          vim
          micro
          fd
          ripgrep
          fzf
          zoxide
          tree
          eza
          bat
          jq
          coreutils
          htop
          ncdu
          zsh
          antigen
        ];
      };
  };

  # ==========================================================================
  # Zsh (system-wide, sources antigen for dotfiles)
  # ==========================================================================
  programs.zsh = {
    enable = true;
    interactiveShellInit = ''
      source ${pkgs.antigen}/share/antigen/antigen.zsh
    '';
  };

  # ==========================================================================
  # System Packages
  # ==========================================================================
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
    ncdu
    kitty.terminfo
  ];

  # ==========================================================================
  # Filesystems (labels set by nixos-raspberrypi image)
  # ==========================================================================
  fileSystems."/" = {
    device = "/dev/disk/by-label/NIXOS_SD";
    fsType = "ext4";
  };

  fileSystems."/boot/firmware" = {
    device = "/dev/disk/by-label/FIRMWARE";
    fsType = "vfat";
  };
}
