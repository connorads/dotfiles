# 1. Source Nix daemon profile (multi-user) - correct PATH including /nix/var/nix/profiles/default/bin
[[ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]] && \
  source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# 2. Set TERMINFO_DIRS before hm-session-vars (which does "export TERM=$TERM" that triggers terminfo lookup)
[[ -d ~/.nix-profile/share/terminfo ]] && \
  export TERMINFO_DIRS="$HOME/.nix-profile/share/terminfo${TERMINFO_DIRS:+:$TERMINFO_DIRS}:/usr/share/terminfo"

# 3. Source home-manager session vars (LOCALE_ARCHIVE, XDG_DATA_DIRS, XCURSOR_PATH)
[[ -f ~/.nix-profile/etc/profile.d/hm-session-vars.sh ]] && \
  source ~/.nix-profile/etc/profile.d/hm-session-vars.sh

# 4. ~/.local/bin for user executables (XDG standard, zsh function symlinks)
[[ -d "$HOME/.local/bin" ]] && export PATH="$HOME/.local/bin:$PATH"
