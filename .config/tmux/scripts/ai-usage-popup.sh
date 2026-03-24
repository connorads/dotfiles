#!/usr/bin/env zsh

emulate -L zsh

"$HOME/.local/bin/ai-usage"

if [[ -t 0 && -t 1 ]]; then
  echo
  read -sk1 '?press any key'
fi
