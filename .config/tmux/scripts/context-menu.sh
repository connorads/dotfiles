#!/usr/bin/env bash
# context-menu.sh: right-click context menus (root MouseDown3* binds).
# Builds a display-menu argv and shows it at the click position. Targets and
# mouse coords are passed explicitly from the bind (run-shell -t= expands them
# against the moused pane/window); extras are resolved here via display-message.
# display-menu runs via run-shell, so no mouse event reaches it and tmux would
# mark the menu MENU_NOMOUSE (any pointer motion dismisses it): -M forces mouse
# handling back on, -O keeps the menu open until a selection or a click away.
# tmux's stock MouseDown3 menus stay available on Alt+right-click.
#
# Usage: context-menu.sh pane <pane_id> <mx> <my>
#        context-menu.sh window <window_id> <active_pane> <cwd> <mx> <my>
#        context-menu.sh session <mx> <my>
#
# The wt-publish/wt-finish/wt-remove modes run INSIDE a display-popup opened by
# the window menu's worktree items: composition stays in bash (testable) and
# the wt-* output/failures stay visible.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
self="${BASH_SOURCE[0]}"

# wt-* are dual-mode zsh functions exposed via ~/.local/bin; the tmux server's
# PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

# Popup epilogue: hold the popup open until a key so output can be read.
wait_key() {
	printf '\nPress any key…'
	read -rsn1 || true
}

tmux_double_quote() {
	local value=$1
	value=${value//\\/\\\\}
	value=${value//\"/\\\"}
	printf '%s' "$value"
}

# Agent dot section, shared by the pane and window menus — literals must match
# agent-state-lib.sh's canonical mapping (drift-guarded by agent-glyphs.bats,
# same as the prefix+Alt+. menu). Appends to the caller's menu array.
append_agent_dot_items() {
	local pane=$1
	menu+=(
		"working  #[fg=#fab387]◐#[default]" w "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh working'"
		"blocked  #[fg=#f38ba8]◆#[default]" b "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh blocked'"
		"unread   #[fg=#89b4fa]●#[default]" u "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh unread'"
		"idle     #[fg=#a6e3a1]○#[default]" i "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh idle'"
		"clear dot" c "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh clear'"
	)
}

case "${1:-}" in
pane)
	pane="${2:?pane_id required}"
	mx="${3:-C}"
	my="${4:-C}"
	info=$(tmux display-message -p -t "$pane" '#{pane_tty}	#{pane_current_command}	#{pane_current_path}	#{window_panes}')
	tty=${info%%	*}
	rest=${info#*	}
	cmd=${rest%%	*}
	rest=${rest#*	}
	path=${rest%%	*}
	pane_count=${rest##*	}
	kill_prompt="kill pane $pane running $cmd? (y/n)"
	if [ "$pane_count" = "1" ]; then
		kill_prompt="kill last pane $pane and close window? (y/n)"
	fi
	quoted_kill_prompt=$(tmux_double_quote "$kill_prompt")

	menu=(display-menu -M -O -t "$pane" -x "$mx" -y "$my" -T " Pane $pane ")
	menu+=(
		"#{?window_zoomed_flag,Unzoom,Zoom}" z "resize-pane -Z -t $pane"
		"#{?pane_marked,Unmark,Mark}" m "select-pane -m -t $pane"
		"Copy pane info (id·tty·cmd·cwd)" y "run-shell \"$dir/copy-pane-info.sh $pane $tty $cmd '$path'\""
		""
		"Open cwd in Zed" e "run-shell 'zed \"$path\"'"
		"Open cwd in VS Code" v "run-shell 'code \"$path\"'"
		"Open cwd in Finder / xdg-open" f "run-shell 'if [ \"\$(uname)\" = \"Darwin\" ]; then open \"$path\"; else xdg-open \"$path\" 2>/dev/null; fi'"
		""
		"Arm/disarm claude-watch" a "run-shell '$HOME/.local/bin/claude-watch $pane'"
		""
	)
	append_agent_dot_items "$pane"
	menu+=(
		""
		"Kill pane" X "confirm-before -p \"$quoted_kill_prompt\" \"kill-pane -t $pane\""
	)
	tmux "${menu[@]}"
	;;
window)
	win="${2:?window_id required}"
	active_pane="${3:?active pane required}"
	cwd="${4:-}"
	mx="${5:-C}"
	my="${6:-C}"
	window_info=$(tmux display-message -p -t "$active_pane" '#{automatic-rename}	#{?automatic-rename,#{b:pane_current_path},#{window_name}}')
	automatic_rename=${window_info%%	*}
	visible_label=${window_info#*	}
	quoted_visible_label=$(tmux_double_quote "$visible_label")
	reset_label="Reset name"
	if [ "$automatic_rename" = "1" ]; then
		reset_label="Auto name"
	fi

	menu=(display-menu -M -O -t "$active_pane" -x "$mx" -y "$my" -T " Window · $visible_label ")
	# Explicit -s: the moused window may not be the current one.
	menu+=(
		"Swap left" "<" "swap-window -s $win -t :-1"
		"Swap right" ">" "swap-window -s $win -t :+1"
		"Rename" r "command-prompt -I \"$quoted_visible_label\" -p \"Manual window label:\" \"rename-window -t $win '%%'\""
		"$reset_label" a "set-window-option -t $win automatic-rename on"
		"Kill" X "confirm-before -p \"kill window $quoted_visible_label? (y/n)\" \"kill-window -t $win\""
		""
	)
	append_agent_dot_items "$active_pane"
	# Worktree windows get lifecycle actions; each runs this script's popup
	# modes below so wt-* output/failures stay visible. kill-window fires only
	# after the wt command succeeds.
	case "$cwd" in
	"$HOME"/.trees/*)
		menu+=(
			""
			"Publish PR (wt-publish)" p "display-popup -E -w 80% -h 60% \"$self wt-publish '$cwd'\""
			"Finish: merge → base, close window" F "display-popup -E -w 80% -h 60% -d \"$HOME\" \"$self wt-finish $win '$cwd'\""
			"Remove worktree, close window" D "display-popup -E -w 80% -h 60% -d \"$HOME\" \"$self wt-remove $win '$cwd'\""
		)
		;;
	esac
	tmux "${menu[@]}"
	;;
wt-publish)
	cwd="${2:?path required}"
	wt-publish --pr "$cwd" || printf 'wt-publish failed\n' >&2
	wait_key
	;;
wt-finish)
	win="${2:?window_id required}"
	cwd="${3:?path required}"
	if wt-finish --mode local "$cwd"; then
		tmux kill-window -t "$win"
	else
		printf 'wt-finish failed — window left open\n' >&2
		wait_key
	fi
	;;
wt-remove)
	win="${2:?window_id required}"
	cwd="${3:?path required}"
	if wt-remove "$cwd"; then
		tmux kill-window -t "$win"
	else
		printf 'wt-remove failed — window left open\n' >&2
		wait_key
	fi
	;;
session)
	mx="${2:-C}"
	my="${3:-C}"
	# Picker/popup bodies mirror the prefix+S / W / L / Alt+m binds in tmux.conf.
	menu=(display-menu -M -O -x "$mx" -y "$my" -T " Session #S ")
	menu+=(
		"Session picker (fzf)" s "display-popup -E \"tmux list-sessions -F '#{session_name}' | fzf --reverse --header='Switch session' | xargs -I{} tmux switch-client -t {}\""
		"Window picker (fzf)" w "display-popup -E \"tmux list-windows -a -F '#{session_name}:#{window_index} #{window_name}' | fzf --reverse --header='Switch window' | cut -d' ' -f1 | xargs -I{} tmux switch-client -t {}\""
		"Layout presets" l "display-popup -E \"grep -h '^#' ~/.config/tmux/layouts/*.conf | sed 's/^# //' | fzf --reverse --header='Layout' | cut -d: -f1 | xargs -I{} tmux source-file ~/.config/tmux/layouts/{}.conf\""
		"Memory pressure" m "display-popup -E -h 60% -w 70% '$dir/mem-popup.sh'"
		""
		"Detach" d "detach-client"
	)
	tmux "${menu[@]}"
	;;
*)
	echo "usage: context-menu.sh pane <pane_id> <mx> <my> | window <window_id> <active_pane> <cwd> <mx> <my> | session <mx> <my>" >&2
	exit 1
	;;
esac
