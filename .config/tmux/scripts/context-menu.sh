#!/usr/bin/env bash
# context-menu.sh: right-click context menus (root MouseDown3* binds).
# Builds a display-menu argv and shows it at the click position. Targets and
# mouse coords are passed explicitly from the bind (run-shell -t= expands them
# against the moused pane/window); extras are resolved here via display-message.
# tmux's stock MouseDown3 menus stay available on Alt+right-click.
#
# Usage: context-menu.sh pane <pane_id> <mx> <my>
#        context-menu.sh session <mx> <my>
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
pane)
	pane="${2:?pane_id required}"
	mx="${3:-C}"
	my="${4:-C}"
	info=$(tmux display-message -p -t "$pane" '#{pane_tty}	#{pane_current_command}	#{pane_current_path}')
	tty=${info%%	*}
	rest=${info#*	}
	cmd=${rest%%	*}
	path=${rest##*	}

	menu=(display-menu -t "$pane" -x "$mx" -y "$my" -T " Pane $pane ")
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
	# Agent dot section — literals must match agent-state-lib.sh's canonical
	# mapping (drift-guarded by agent-glyphs.bats, same as the prefix+Alt+. menu).
	menu+=(
		"working  #[fg=#fab387]◐#[default]" w "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh working'"
		"blocked  #[fg=#f38ba8]◆#[default]" b "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh blocked'"
		"unread   #[fg=#89b4fa]●#[default]" u "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh unread'"
		"idle     #[fg=#a6e3a1]○#[default]" i "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh idle'"
		"clear dot" c "run-shell 'AGENT_STATE_PANE=$pane $dir/agent-state.sh clear'"
	)
	tmux "${menu[@]}"
	;;
session)
	mx="${2:-C}"
	my="${3:-C}"
	# Picker/popup bodies mirror the prefix+S / W / L / Alt+m binds in tmux.conf.
	menu=(display-menu -x "$mx" -y "$my" -T " Session #S ")
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
	echo "usage: context-menu.sh pane <pane_id> <mx> <my> | session <mx> <my>" >&2
	exit 1
	;;
esac
