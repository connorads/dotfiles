#!/usr/bin/env bash
# organiser.sh: tmux session/window/pane organiser behind touch menus.
set -euo pipefail

dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

tmux_quote() {
	local value=$1
	value=${value//\\/\\\\}
	value=${value//\"/\\\"}
	printf '%s' "$value"
}

format_label() {
	local value=$1
	value=${value//#/##}
	printf '%s' "$value"
}

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

client_height() {
	local client=${1:-}
	local height
	height="$(tmux display-message ${client:+-c "$client"} -p '#{client_height}' 2>/dev/null || printf 24)"
	[[ "$height" =~ ^[0-9]+$ ]] || height=24
	printf '%s' "$height"
}

page_size() {
	local height=$1
	local size=$((height - 9))
	[ "$size" -lt 4 ] && size=4
	[ "$size" -gt 18 ] && size=18
	printf '%s' "$size"
}

target_session_id() {
	tmux display-message -p -t "$1" '#{session_id}'
}

target_window_id() {
	tmux display-message -p -t "$1" '#{window_id}'
}

target_window_info() {
	tmux display-message -p -t "$1" '#{session_id}	#{session_name}	#{window_id}	#{window_index}	#{?automatic-rename,#{b:pane_current_path},#{window_name}}	#{window_linked}	#{window_linked_sessions}	#{session_windows}'
}

target_pane_info() {
	tmux display-message -p -t "$1" '#{session_id}	#{session_name}	#{window_id}	#{pane_id}	#{window_panes}	#{session_windows}	#{pane_tty}	#{pane_current_command}	#{pane_current_path}'
}

session_has_window() {
	local session=$1 window=$2
	tmux list-windows -t "$session" -F '#{window_id}' | grep -Fxq "$window"
}

client_exists() {
	local client=$1
	[ -n "$client" ] || return 1
	tmux list-clients -F '#{client_name}' 2>/dev/null | grep -Fxq "$client"
}

switch_client_if_present() {
	local client=$1 session=$2
	client_exists "$client" || return 0
	tmux switch-client -c "$client" -t "$session"
}

all_sessions() {
	tmux list-sessions -F '#{session_id}	#{session_name}'
}

menu_base() {
	local client=$1 pane=$2 mx=$3 my=$4 title=$5
	menu=(display-menu -M -O)
	[ -n "$client" ] && menu+=(-c "$client")
	[ -n "$pane" ] && menu+=(-t "$pane")
	menu+=(-x "$mx" -y "$my" -T "$title")
}

confirm_if() {
	local needs_confirm=$1 prompt=$2 command=$3
	if [ "$needs_confirm" = 1 ]; then
		printf 'confirm-before -p "%s" "%s"' "$(tmux_quote "$prompt")" "$(tmux_quote "$command")"
	else
		printf '%s' "$command"
	fi
}

show_no_destinations() {
	local client=$1 pane=$2 mx=$3 my=$4 title=$5 message=$6
	menu_base "$client" "$pane" "$mx" "$my" "$title"
	menu+=("-$message" "" "")
	tmux "${menu[@]}"
}

window_destination_menu() {
	local mode=$1 client=$2 win=$3 pane=$4 mx=$5 my=$6 page=${7:-0}
	local info src_session src_name src_win win_index label linked src_windows
	info="$(target_window_info "$win")"
	IFS=$'\t' read -r src_session src_name src_win win_index label linked _ src_windows <<<"$info"

	local -a destinations
	destinations=()
	while IFS=$'\t' read -r session_id session_name; do
		[ "$session_id" != "$src_session" ] || continue
		case "$mode" in
		move-follow | move-background)
			destinations+=("$session_id"$'\t'"$session_name")
			;;
		share)
			session_has_window "$session_id" "$src_win" && continue
			destinations+=("$session_id"$'\t'"$session_name")
			;;
		esac
	done < <(all_sessions)

	if [ "${#destinations[@]}" -eq 0 ]; then
		show_no_destinations "$client" "$pane" "$mx" "$my" " $(format_label "$label") " "No eligible sessions"
		return
	fi

	local height size total start end i title
	height="$(client_height "$client")"
	size="$(page_size "$height")"
	total=${#destinations[@]}
	start=$((page * size))
	[ "$start" -ge "$total" ] && start=0
	end=$((start + size))
	[ "$end" -gt "$total" ] && end=$total
	title=" $(format_label "$label") → session $((page + 1))/$(((total + size - 1) / size)) "
	menu_base "$client" "$pane" "$mx" "$my" "$title"
	if [ "$start" -gt 0 ]; then
		menu+=("Previous" "<" "run-shell '$dir/organiser.sh window-dest $mode \"$client\" \"$src_win\" \"$pane\" \"$mx\" \"$my\" $((page - 1))'")
	fi
	for ((i = start; i < end; i++)); do
		IFS=$'\t' read -r session_id session_name <<<"${destinations[$i]}"
		menu+=("$(format_label "$session_name")" "" "run-shell '$dir/organiser.sh action-window $mode \"$client\" \"$src_win\" \"$session_id\"'")
	done
	if [ "$end" -lt "$total" ]; then
		menu+=("Next" ">" "run-shell '$dir/organiser.sh window-dest $mode \"$client\" \"$src_win\" \"$pane\" \"$mx\" \"$my\" $((page + 1))'")
	fi
	tmux "${menu[@]}"
}

pane_destination_menu() {
	local mode=$1 client=$2 pane=$3 mx=$4 my=$5 page=${6:-0}
	local info src_session src_name src_win src_pane pane_count src_windows tty cmd path
	info="$(target_pane_info "$pane")"
	IFS=$'\t' read -r src_session src_name src_win src_pane pane_count src_windows tty cmd path <<<"$info"

	if [ "$pane_count" = 1 ]; then
		show_no_destinations "$client" "$pane" "$mx" "$my" " Pane $src_pane " "Break disabled: pane is already the only pane"
		return
	fi

	local -a destinations
	destinations=()
	while IFS=$'\t' read -r session_id session_name; do
		destinations+=("$session_id"$'\t'"$session_name")
	done < <(all_sessions)

	local height size total start end i title
	height="$(client_height "$client")"
	size="$(page_size "$height")"
	total=${#destinations[@]}
	start=$((page * size))
	[ "$start" -ge "$total" ] && start=0
	end=$((start + size))
	[ "$end" -gt "$total" ] && end=$total
	title=" Break pane → session $((page + 1))/$(((total + size - 1) / size)) "
	menu_base "$client" "$pane" "$mx" "$my" "$title"
	if [ "$start" -gt 0 ]; then
		menu+=("Previous" "<" "run-shell '$dir/organiser.sh pane-dest $mode \"$client\" \"$src_pane\" \"$mx\" \"$my\" $((page - 1))'")
	fi
	for ((i = start; i < end; i++)); do
		IFS=$'\t' read -r session_id session_name <<<"${destinations[$i]}"
		menu+=("$(format_label "$session_name")" "" "run-shell '$dir/organiser.sh action-pane-break $mode \"$client\" \"$src_pane\" \"$session_id\"'")
	done
	if [ "$end" -lt "$total" ]; then
		menu+=("Next" ">" "run-shell '$dir/organiser.sh pane-dest $mode \"$client\" \"$src_pane\" \"$mx\" \"$my\" $((page + 1))'")
	fi
	tmux "${menu[@]}"
}

marked_pane_record() {
	tmux list-panes -a -F '#{pane_marked}	#{session_id}	#{session_name}	#{window_id}	#{pane_id}	#{window_panes}	#{session_windows}' |
		awk -F '\t' '$1 == 1 {print; exit}'
}

window_menu() {
	local client=${1:-} win=${2:?window required} pane=${3:?pane required} cwd=${4:-} mx=${5:-C} my=${6:-C}
	local info session_id session_name window_id win_index label linked session_windows
	info="$(target_window_info "$win")"
	IFS=$'\t' read -r session_id session_name window_id win_index label linked _ session_windows <<<"$info"
	local qlabel
	qlabel="$(tmux_quote "$label")"
	menu_base "$client" "$pane" "$mx" "$my" " Window · $(format_label "$label") "
	menu+=(
		"Move and follow…" "m" "run-shell '$dir/organiser.sh window-dest move-follow \"$client\" \"$window_id\" \"$pane\" \"$mx\" \"$my\" 0'"
		"Move in background…" "b" "run-shell '$dir/organiser.sh window-dest move-background \"$client\" \"$window_id\" \"$pane\" \"$mx\" \"$my\" 0'"
		"Share with session…" "s" "run-shell '$dir/organiser.sh window-dest share \"$client\" \"$window_id\" \"$pane\" \"$mx\" \"$my\" 0'"
	)
	if [ "$linked" = 1 ]; then
		menu+=("Remove from this session" "u" "$(confirm_if "$([ "$session_windows" = 1 ] && printf 1 || printf 0)" "remove $label from $session_name and close the session? (y/n)" "unlink-window -t $session_id:$win_index")")
		menu+=("Kill shared window everywhere" "X" "confirm-before -p \"kill shared window $qlabel everywhere? (y/n)\" \"kill-window -t $window_id\"")
	else
		menu+=("-Remove from this session" "" "")
		menu+=("Kill window" "X" "confirm-before -p \"kill window $qlabel? (y/n)\" \"kill-window -t $window_id\"")
	fi
	menu+=(
		""
		"Swap left" "<" "swap-window -s $window_id -t :-1"
		"Swap right" ">" "swap-window -s $window_id -t :+1"
		"Rename" "r" "command-prompt -I \"$qlabel\" -p \"Manual window label:\" \"rename-window -t $window_id '%%'\""
		"Auto name" "a" "set-window-option -t $window_id automatic-rename on"
	)
	menu+=("")
	append_agent_dot_items "$pane"
	case "$cwd" in
	"$HOME"/.trees/*)
		menu+=(
			""
			"Publish PR (wt-publish)" p "display-popup -E -w 80% -h 60% \"$dir/context-menu.sh wt-publish '$cwd'\""
			"Finish: merge → base, close window" F "display-popup -E -w 80% -h 60% -d \"$HOME\" \"$dir/context-menu.sh wt-finish $window_id '$cwd'\""
			"Remove worktree, close window" D "display-popup -E -w 80% -h 60% -d \"$HOME\" \"$dir/context-menu.sh wt-remove $window_id '$cwd'\""
		)
		;;
	esac
	tmux "${menu[@]}"
}

pane_menu() {
	local client=${1:-} pane=${2:?pane required} mx=${3:-C} my=${4:-C}
	local info session_id session_name window_id pane_id pane_count session_windows tty cmd path
	info="$(target_pane_info "$pane")"
	IFS=$'\t' read -r session_id session_name window_id pane_id pane_count session_windows tty cmd path <<<"$info"
	local marked marked_window marked_pane
	marked="$(marked_pane_record || true)"
	menu_base "$client" "$pane_id" "$mx" "$my" " Pane $pane_id "
	menu+=(
		"#[?window_zoomed_flag,Unzoom,Zoom]" "z" "resize-pane -Z -t $pane_id"
		"#[?pane_marked,Unmark,Mark]" "m" "select-pane -m -t $pane_id"
		"Break and follow…" "f" "run-shell '$dir/organiser.sh pane-dest break-follow \"$client\" \"$pane_id\" \"$mx\" \"$my\" 0'"
		"Break in background…" "b" "run-shell '$dir/organiser.sh pane-dest break-background \"$client\" \"$pane_id\" \"$mx\" \"$my\" 0'"
	)
	if [ -n "$marked" ]; then
		IFS=$'\t' read -r _ _ _ marked_window marked_pane _ _ <<<"$marked"
		if [ "$marked_window" != "$window_id" ]; then
			menu+=(
				""
				"Join marked pane here…" "" ""
				"Left" "h" "run-shell '$dir/organiser.sh action-pane-join left \"$client\" \"$marked_pane\" \"$pane_id\"'"
				"Right" "l" "run-shell '$dir/organiser.sh action-pane-join right \"$client\" \"$marked_pane\" \"$pane_id\"'"
				"Above" "k" "run-shell '$dir/organiser.sh action-pane-join above \"$client\" \"$marked_pane\" \"$pane_id\"'"
				"Below" "j" "run-shell '$dir/organiser.sh action-pane-join below \"$client\" \"$marked_pane\" \"$pane_id\"'"
			)
		fi
	fi
	menu+=(
		""
		"Copy pane info (id·tty·cmd·cwd)" "y" "run-shell \"$dir/copy-pane-info.sh $pane_id $tty $cmd '$path'\""
		"Arm/disarm claude-watch" "a" "run-shell '$HOME/.local/bin/claude-watch $pane_id'"
		""
	)
	append_agent_dot_items "$pane_id"
	menu+=(
		""
		"Kill pane" "X" "confirm-before -p \"kill pane $pane_id running $(tmux_quote "$cmd")? (y/n)\" \"kill-pane -t $pane_id\""
	)
	tmux "${menu[@]}"
}

session_menu() {
	local client=${1:-} mx=${2:-C} my=${3:-C}
	menu_base "$client" "" "$mx" "$my" " Session #S "
	menu+=(
		"Organise window" "W" "run-shell '$dir/organiser.sh window \"$client\" \"#{window_id}\" \"#{pane_id}\" \"#{pane_current_path}\" C C'"
		"Session picker (fzf)" "s" "display-popup -E \"tmux list-sessions -F '#{session_name}' | fzf --reverse --header='Switch session' | xargs -I{} tmux switch-client -t {}\""
		"Window tree" "w" "choose-tree -Zw"
		"Agents popup" "A" "display-popup -E -h 80% -w 85% '$dir/agent-popup.sh'"
		"Memory pressure" "m" "display-popup -E -h 60% -w 70% '$dir/mem-popup.sh'"
		""
		"Detach" "d" "detach-client"
	)
	tmux "${menu[@]}"
}

action_window() {
	local mode=$1 client=$2 win=$3 dest=$4
	local info src_session src_name src_win win_index label linked session_windows
	info="$(target_window_info "$win")"
	IFS=$'\t' read -r src_session src_name src_win win_index label linked _ session_windows <<<"$info"
	case "$mode" in
	move-follow)
		if [ "$session_windows" = 1 ]; then
			tmux confirm-before -p "move $label and close $src_name? (y/n)" "move-window -s $src_win -t $dest: \\; switch-client -c $client -t $dest \\; select-window -t $src_win"
		else
			tmux move-window -s "$src_win" -t "$dest:"
			switch_client_if_present "$client" "$dest"
			tmux select-window -t "$src_win"
		fi
		;;
	move-background)
		if [ "$session_windows" = 1 ]; then
			tmux confirm-before -p "move $label in background and close $src_name? (y/n)" "move-window -d -s $src_win -t $dest:"
		else
			tmux move-window -d -s "$src_win" -t "$dest:"
		fi
		;;
	share)
		tmux link-window -d -s "$src_win" -t "$dest:"
		;;
	esac
}

action_pane_break() {
	local mode=$1 client=$2 pane=$3 dest=$4
	local info src_session src_name src_win src_pane pane_count src_windows tty cmd path
	info="$(target_pane_info "$pane")"
	IFS=$'\t' read -r src_session src_name src_win src_pane pane_count src_windows tty cmd path <<<"$info"
	if [ "$pane_count" = 1 ]; then
		tmux display-message -c "$client" "Break disabled: pane is already the only pane"
		return 1
	fi
	case "$mode" in
	break-follow)
		local new_win
		new_win="$(tmux break-pane -s "$src_pane" -t "$dest:" -P -F '#{window_id}')"
		switch_client_if_present "$client" "$dest"
		tmux select-window -t "$new_win"
		;;
	break-background)
		tmux break-pane -d -s "$src_pane" -t "$dest:"
		;;
	esac
}

action_pane_join() {
	local direction=$1 client=$2 source=$3 dest=$4
	local src dst needs_confirm prompt command
	local -a flags
	src="$(tmux display-message -p -t "$source" '#{session_id}	#{session_name}	#{window_id}	#{window_panes}	#{session_windows}')"
	dst="$(tmux display-message -p -t "$dest" '#{session_id}	#{window_id}')"
	IFS=$'\t' read -r src_session src_name _ src_panes src_windows <<<"$src"
	IFS=$'\t' read -r dst_session dst_window <<<"$dst"
	flags=()
	case "$direction" in
	left) flags=(-h -b) ;;
	right) flags=(-h) ;;
	above) flags=(-v -b) ;;
	below) flags=(-v) ;;
	esac
	command="join-pane ${flags[*]} -s $source -t $dest \\; switch-client -c $client -t $dst_session \\; select-window -t $dst_window \\; select-pane -t $dest"
	needs_confirm=0
	if [ "$src_panes" = 1 ] && [ "$src_windows" = 1 ]; then
		needs_confirm=1
	fi
	prompt="join marked pane and close $src_name? (y/n)"
	if [ "$needs_confirm" = 1 ]; then
		tmux confirm-before -p "$prompt" "$command"
	else
		tmux join-pane "${flags[@]}" -s "$source" -t "$dest"
		switch_client_if_present "$client" "$dst_session"
		tmux select-window -t "$dst_window"
		tmux select-pane -t "$dest"
	fi
}

case "${1:-}" in
window)
	shift
	window_menu "$@"
	;;
pane)
	shift
	pane_menu "$@"
	;;
session)
	shift
	session_menu "$@"
	;;
window-dest)
	shift
	window_destination_menu "$@"
	;;
pane-dest)
	shift
	pane_destination_menu "$@"
	;;
action-window)
	shift
	action_window "$@"
	;;
action-pane-break)
	shift
	action_pane_break "$@"
	;;
action-pane-join)
	shift
	action_pane_join "$@"
	;;
*)
	echo "usage: organiser.sh window|pane|session|window-dest|pane-dest|action-*" >&2
	exit 1
	;;
esac
