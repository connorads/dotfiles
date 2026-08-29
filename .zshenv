# 1. Source Nix daemon profile (multi-user) - correct PATH including /nix/var/nix/profiles/default/bin
[[ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]] && \
  source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# 2. Set TERMINFO_DIRS before hm-session-vars (which does "export TERM=$TERM" that triggers terminfo lookup)
[[ -d ~/.nix-profile/share/terminfo ]] && \
  export TERMINFO_DIRS="$HOME/.nix-profile/share/terminfo${TERMINFO_DIRS:+:$TERMINFO_DIRS}:/usr/share/terminfo"

# 3. Source home-manager session vars (EDITOR, VISUAL, XDG_*, TERMINFO_DIRS).
#    Standalone home-manager writes these under ~/.nix-profile; as a nix-darwin
#    module it writes them under /etc/profiles/per-user/$USER, and there
#    ~/.nix-profile does not exist at all. Probe both so one declaration in
#    home-shared.nix reaches every host.
for _hm_vars in \
	"$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" \
	"/etc/profiles/per-user/${USER:-$(id -un)}/etc/profile.d/hm-session-vars.sh"; do
	[[ -f $_hm_vars ]] && source "$_hm_vars" && break
done
unset _hm_vars

# 4. ~/.local/bin for user executables (XDG standard, zsh function symlinks)
[[ -d "$HOME/.local/bin" ]] && export PATH="$HOME/.local/bin:$PATH"

# 5. Granted (granted.dev): source `assume` so it can export AWS creds into this shell (a subprocess can't)
alias assume=". assume"
