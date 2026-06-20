# ==============================================================================
# macOS (nix-darwin) Configuration — Desktop (MacBook Air)
# ==============================================================================
#
# Normal workstation: GUI apps, casks, UI defaults, Touch ID sudo, app
# associations. Imported alongside darwin-shared.nix.
#
# The full environment.systemPackages list is repeated here verbatim (original
# order) rather than shared: module merge is `shared ++ host`, which would
# reorder a shared list and change the Air's .system derivation. Listing the
# whole list in one module keeps the Air byte-for-byte. The server lists its
# own subset (4 pkgs duplicated across host modules — accepted).
{
  lib,
  config,
  pkgs,
  packages,
  ...
}:
{
  imports = [ ./biokc.nix ];

  # Converge LocalHostName so bare `drs`/`up` resolve to this config after the
  # first explicit-`#attr` bootstrap (mirrors darwin-server.nix). networking.hostName
  # sets LocalHostName because networking.localHostName defaults to it.
  networking.hostName = "Connors-MacBook-Air";

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

  # -- Homebrew (desktop casks / MAS apps / taps) --
  homebrew = {
    taps = [ "manaflow-ai/cmux" ];
    casks = [
      # Apps
      "kitty"
      "sublime-text"
      "sublime-merge"
      "bitwarden"
      "chatgpt"
      "claude"
      "cmux"
      "codex-app"
      "blender"
      "comfyui"
      "gimp"
      "lm-studio"
      "obsidian"
      "whatsapp"
      "telegram-desktop"
      "steam"
      "utm"
      "retroarch"
      "android-studio"
      "android-commandlinetools"
      "visual-studio-code"
      "visual-studio-code@insiders"
      "cursor"
      "kiro"
      "antigravity"
      "t3-code"
      "zed"
      "zappy"
      "calibre"
      "onedrive"
      "macwhisper"
      "native-access"
      "google-chrome"
      "google-gemini"
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
      "executor"
      "conductor"
      "knockknock"
      "slack"
      "microsoft-teams"
      "linear-linear"
      "miro"

      "blackhole-16ch"
    ];
    masApps = {
      RunCat = 1429033973;
      Perplexity = 6714467650;
    };
  };

  # -- System Defaults (macOS preferences) --
  system.defaults = {
    dock = {
      autohide = true;
      show-recents = false;
      persistent-apps = [
        "/Applications/kitty.app"
        "/Applications/Google Chrome.app"
        # Steam self-updates into ~/Library/Application Support/Steam/Steam.AppBundle,
        # which can appear as a separate running app in the Dock.
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
      KeyRepeat = 2;
      InitialKeyRepeat = 25;
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

      # Keyboard: British - PC layout (ID 250)
      "com.apple.HIToolbox" = {
        AppleCurrentKeyboardLayoutInputSourceID = "com.apple.keylayout.British-PC";
        AppleEnabledInputSources = [
          {
            InputSourceKind = "Keyboard Layout";
            "KeyboardLayout ID" = 250;
            "KeyboardLayout Name" = "British-PC";
          }
        ];
      };

      # Finder > Settings > Advanced > "Remove items from the Trash after 30 days"
      "com.apple.finder" = {
        FXRemoveOldTrashItems = true;
      };

      # Hide the keyboard input source ("A" / "British – PC") menu bar icon
      "com.apple.TextInputMenu" = {
        visible = false;
      };
    };
  };

  # Hide the Spotlight menu bar icon (⌘+Space is rebound to Raycast above).
  # MenuItemHidden lives in ByHost and needs `defaults -currentHost`, which has no
  # declarative nix-darwin option (nix-darwin#1721). Activation runs as root, so drop
  # to the primary user for -currentHost to hit the right per-user ByHost plist.
  #
  # lib.mkBefore (priority 500) sorts this ahead of shared's MagicDNS resolver,
  # reproducing today's Spotlight-then-MagicDNS postActivation order.
  system.activationScripts.postActivation.text = lib.mkBefore ''
    sudo -u ${config.system.primaryUser} -H /usr/bin/defaults -currentHost write com.apple.Spotlight MenuItemHidden -int 1
  '';

  # -- PAM / sudo authentication --
  # Touch ID + YubiKey (pam_u2f) sudo. Desktop-only: the headless server has no
  # Touch ID / security-key hardware, so it omits sudo_local entirely and falls
  # through to password (pam_unix).
  security.pam.services.sudo_local = {
    enable = true;
    touchIdAuth = true;
    reattach = true;
    text = ''
      auth       sufficient     ${pkgs.pam_u2f}/lib/security/pam_u2f.so cue
    '';
  };

  # -- Home Manager (desktop additions) --
  # Merges into the shared home-manager.users.connorads submodule, closing over
  # this module's `pkgs`/`packages` args.
  home-manager.users.connorads =
    { lib, ... }:
    {
      home.packages = packages.sharedPackages ++ [
        pkgs.duti
        pkgs.pngpaste
      ];

      # Set default macOS app associations declaratively.
      # Uses duti because nix-darwin has no built-in file association support
      # and home-manager's xdg.mimeApps is Linux-only.
      #
      # Only extensions with declared system UTIs work — dynamic UTIs (dyn.*)
      # cause duti to fail, which under set -eu aborts the entire home-manager
      # activation (blocking ALL symlink creation including git config).
      # Some formats are therefore covered by broad UTI mappings instead.
      home.activation.defaultAppAssociations = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        set_default_app() {
          local app_id="$1"
          local selector="$2"
          ${pkgs.duti}/bin/duti -s "$app_id" "$selector" all || true
        }

        text_app_id="com.sublimetext.4"
        for ext in md txt json yaml yml csv tsv js ts css; do
          set_default_app "$text_app_id" "$ext"
        done

        # .ts is also MPEG transport stream on macOS; prefer TypeScript in Finder.
        for uti in net.daringfireball.markdown public.plain-text public.json public.yaml public.comma-separated-values-text public.tab-separated-values-text public.css public.mpeg-2-transport-stream; do
          set_default_app "$text_app_id" "$uti"
        done

        media_app_id="com.colliderli.iina"
        for ext in mp4 m4v mkv mov avi webm mpg mpeg m2ts flv wmv mp3 m4a aac flac wav ogg opus; do
          set_default_app "$media_app_id" "$ext"
        done

        for uti in public.movie public.video public.audio public.audiovisual-content; do
          set_default_app "$media_app_id" "$uti"
        done
      '';

      # macOS-specific: use Keychain for git credentials
      programs.git.settings.credential.helper = "osxkeychain";
    };
}
