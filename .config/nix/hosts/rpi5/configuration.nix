# Raspberry Pi 5 NixOS Configuration
# Rebuild: nixos-rebuild switch --flake ~/.config/nix#rpi5
{
  config,
  pkgs,
  lib,
  nix-clawdbot,
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
  services.tailscale = {
    enable = true;
    extraSetFlags = [
      "--operator=connor"
      "--hostname=rpi5"
    ];
  };

  # ==========================================================================
  # Automatic Updates (pulls from GitHub daily, rebuilds if changed)
  # ==========================================================================
  system.autoUpgrade = {
    enable = true;
    flake = "github:connorads/dotfiles?dir=.config/nix#rpi5";
    flags = [ "--refresh" "--print-build-logs" ];
    dates = "04:00";
    randomizedDelaySec = "45min";
    allowReboot = true;
    rebootWindow = {
      lower = "03:00";
      upper = "06:00";
    };
  };

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
    extraSpecialArgs = { inherit nix-clawdbot; };
    users.connor =
      { pkgs, nix-clawdbot, ... }:
      {
        imports = [
          nix-clawdbot.homeManagerModules.clawdbot
        ];

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

        # ======================================================================
        # Clawdbot (AI assistant gateway)
        # ======================================================================
        programs.clawdbot.instances.default = {
          enable = true;

          # Use OpenAI instead of Anthropic
          agent.model = "openai/gpt-5-nano";

          # Web UI: Tailscale Serve (Tailscale identity auth)
          # Access at https://rpi5.<tailnet>.ts.net
          gatewayTailscale = "serve";

          # Disable heartbeat (burns tokens)
          configOverrides.agents.defaults.heartbeat.every = "0m";
          # Disable thinking (avoid OpenAI reasoning payload errors)
          configOverrides.agents.defaults.thinkingDefault = "off";

          # Telegram provider (user ID loaded at runtime via $include)
          providers.telegram = {
            enable = true;
            botTokenFile = "/home/connor/.secrets/telegram-bot-token";
            allowFromFile = "/home/connor/.secrets/telegram-users.json";
          };
        };

        # Disable first-party plugins (core gateway only)
        programs.clawdbot.firstParty = {
          summarize.enable = false;
          peekaboo.enable = false;
          oracle.enable = false;
          poltergeist.enable = false;
          sag.enable = false;
          camsnap.enable = false;
          gogcli.enable = false;
          bird.enable = false;
          sonoscli.enable = false;
          imsg.enable = false;
        };

        # OpenAI API key via systemd EnvironmentFile
        # (nix-clawdbot module is Anthropic-focused)
        systemd.user.services.clawdbot-gateway.Service.EnvironmentFile =
          "/home/connor/.secrets/clawdbot.env";
        # Ensure tailscale is on PATH for --tailscale serve
        systemd.user.services.clawdbot-gateway.path = [ pkgs.tailscale ];

        # ======================================================================
        # Clawdbot workspace backup (syncs ~/clawd to GitHub daily)
        # ======================================================================
        systemd.user.services.clawd-workspace-sync = {
          Unit.Description = "Sync Clawdbot workspace to GitHub";
          Service = {
            Type = "oneshot";
            ExecStart = pkgs.writeShellScript "clawd-workspace-sync" ''
              set -euo pipefail
              WORKSPACE="/home/connor/clawd"
              cd "$WORKSPACE" || exit 0

              # Init repo if not exists
              if [ ! -d .git ]; then
                ${pkgs.git}/bin/git init
                ${pkgs.git}/bin/git remote add origin git@github.com-clawd:connorads/clawd-workspace.git
              fi

              # Commit and push if changes
              ${pkgs.git}/bin/git add -A
              ${pkgs.git}/bin/git diff --cached --quiet || \
                ${pkgs.git}/bin/git commit -m "Auto-sync $(date -I)"
              ${pkgs.git}/bin/git push -u origin main || true
            '';
          };
        };

        systemd.user.timers.clawd-workspace-sync = {
          Unit.Description = "Sync Clawdbot workspace daily";
          Timer = {
            OnCalendar = "daily";
            Persistent = true;
          };
          Install.WantedBy = [ "timers.target" ];
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
