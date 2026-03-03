#!/usr/bin/env zsh
# bell-random: play a random bell sound from the select pool
emulate -L zsh

RANDOM=$(( $(od -An -tu4 -N4 /dev/urandom) ))

local dir="$HOME/.local/share/terminal-bells/select"
local files=("$dir"/*.wav(N))
(( ${#files} )) || return 0
afplay "$files[RANDOM % ${#files} + 1]" &
