#!/bin/sh
# layout-n: create a deterministic two-row N-pane layout

count="${1:-}"
target_pane="${2:-}"

if [ -z "${TMUX:-}" ]; then
	exit 0
fi

if [ -z "$target_pane" ]; then
	target_pane="$(tmux display-message -p '#{pane_id}')"
fi

case "$count" in
'' | *[!0-9]*)
	tmux display-message "Pane count must be a whole number"
	exit 1
	;;
esac

if [ "$count" -lt 1 ]; then
	tmux display-message "Pane count must be at least 1"
	exit 1
fi

if [ "$count" -gt 64 ]; then
	tmux display-message "Pane count too high (max 64)"
	exit 1
fi

target_window="$(tmux display-message -p -t "$target_pane" '#{window_id}')"
pane_path="$(tmux display-message -p -t "$target_pane" '#{pane_current_path}')"
current_count="$(tmux list-panes -t "$target_window" | wc -l | tr -d ' ')"
min_cols=$(((count + 1) / 2))

# Preserve existing panes: if we already have many panes, treat them as columns
# and only add the second-row splits needed to reach N.
if [ "$current_count" -gt "$min_cols" ]; then
	cols="$current_count"
else
	cols="$min_cols"
fi

bottom=$((count - cols))

if [ "$current_count" -gt "$count" ]; then
	tmux select-pane -t "$target_pane" >/dev/null 2>&1 || true
	tmux display-message "Window has $current_count panes (> $count), left unchanged"
	exit 0
fi

if [ "$current_count" -eq "$count" ]; then
	tmux select-pane -t "$target_pane" >/dev/null 2>&1 || true
	tmux display-message "Already $count panes, left unchanged"
	exit 0
fi

while [ "$current_count" -lt "$cols" ]; do
	if ! tmux split-window -d -h -t "$target_pane" -c "$pane_path" >/dev/null 2>&1; then
		break
	fi
	current_count=$((current_count + 1))
done

if [ "$current_count" -ne "$cols" ]; then
	tmux select-pane -t "$target_pane" >/dev/null 2>&1 || true
	tmux display-message "Could not create $cols columns (created $current_count)"
	exit 0
fi

tmux select-layout -t "$target_window" even-horizontal >/dev/null 2>&1 || true

if [ "$bottom" -gt 0 ]; then
	selected="$(tmux list-panes -t "$target_window" -F '#{pane_id} #{pane_left}' | sort -k2,2n | head -n "$bottom" | sort -k2,2nr | awk '{print $1}')"
	if [ -n "$selected" ]; then
		for pane_id in $selected; do
			if ! tmux split-window -d -v -t "$pane_id" -p 50 -c "$pane_path" >/dev/null 2>&1; then
				break
			fi
		done
	fi
fi

new_count="$(tmux list-panes -t "$target_window" | wc -l | tr -d ' ')"
tmux select-pane -t "$target_pane" >/dev/null 2>&1 || true

if [ "$new_count" -lt "$count" ]; then
	tmux display-message "Created $new_count panes (stopped before $count, likely no space)"
else
	tmux display-message "Created $count panes in a two-row grid"
fi
