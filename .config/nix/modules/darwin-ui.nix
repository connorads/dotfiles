# ==============================================================================
# macOS (nix-darwin) Configuration — Personal UI defaults (any headed Mac)
# ==============================================================================
#
# How I like *any* Mac I sit in front of: dark mode, reversed ("natural" off)
# scroll, fast key-repeat, British-PC layout, my Finder/Dock/menu-bar prefs.
# Imported by mkDarwin for BOTH hosts, so a headed session on the Air or the
# mini looks identical. These are cheap, inert `system.defaults` writes: on a
# truly headless mini nothing reads them, so sharing them costs nothing.
#
# Scope boundary — what lives here vs. the per-host modules:
#   - HERE: host-neutral *personal* defaults (this file).
#   - darwin-desktop.nix: app/hardware-coupled defaults — dock persistent-apps
#     (Air-only apps), ⌘-Space disable (coupled to Raycast), KeyCastr — plus
#     casks/masApps/packages/Touch-ID.
#   - darwin-server.nix: role/hardware config (pmset, mosh firewall, manual
#     SoftwareUpdate, screensaver lock).
#
# Safe to share because `system.defaults` are *attrsets*: nix-darwin merges them
# order-independently, so the evaluated defaults (hence the written plists) are
# identical whether a key comes from here or a host module — the Air's .system
# derivation is byte-identical to before this split. This is the attrset-merge
# property; the desktop module's header warns only about *lists*
# (packages/casks) reordering, which this file does not touch.
{ ... }:
{
  system.defaults = {
    dock = {
      autohide = true;
      show-recents = false;
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
}
