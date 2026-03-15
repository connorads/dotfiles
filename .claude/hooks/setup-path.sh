#!/usr/bin/env bash
# Fix dual-mode zsh functions (ts, killport, etc.) in Claude Code.
#
# Problem: Claude Code's shell snapshot captures autoload stubs but not
# the custom fpath entries from .zshrc. The stubs shadow ~/.local/bin
# symlinks, failing with "function definition file not found".
#
# Solution: prepend ~/.local/bin to PATH and undefine the broken
# autoload stubs so the symlinked scripts are found instead.
if [[ -z "$CLAUDE_ENV_FILE" ]]; then
  exit 0
fi

echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"

# Undefine autoload stubs that shadow ~/.local/bin commands
for cmd in "$HOME"/.local/bin/*; do
  name=$(basename "$cmd")
  echo "unfunction '$name' 2>/dev/null" >> "$CLAUDE_ENV_FILE"
done

exit 0
