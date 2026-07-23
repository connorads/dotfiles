# shellcheck shell=sh
# profile-label.sh: derive the short label for a Claude profile config dir.
# Single source of truth shared by the statusline and the tmux pane-border tag,
# so the two can never disagree about which ccp account a pane runs as.
claude_profile_label() {
	cfg="${1:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}"
	label=$(cat "$cfg/label" 2>/dev/null)
	if [ -z "$label" ]; then
		case "${cfg##*/}" in
		.claude) label=def ;;
		*) label="${cfg##*/}" ;;
		esac
	fi
	printf '%s' "$label"
}
