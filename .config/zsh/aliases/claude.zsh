# https://github.com/anthropics/claude-code

# These session-launch aliases append the local system prompt that overrides
# Claude Code's Bash-tool git commit/branch note. Bare `claude` remains untouched,
# so subcommands like `claude update` and agent/script invocations stay vanilla.
alias c='claude --append-system-prompt-file "$HOME/.claude/system-append.md"'
alias cy='claude --append-system-prompt-file "$HOME/.claude/system-append.md" --dangerously-skip-permissions'
alias cyc='claude --append-system-prompt-file "$HOME/.claude/system-append.md" --dangerously-skip-permissions --channels plugin:telegram@claude-plugins-official'
# cspy: launch with telemetry re-enabled so GrowthBook gates fetch and
# preview/gated features (computer-use, channels) appear. We normally disable
# telemetry (DISABLE_TELEMETRY/DO_NOT_TRACK in .zshrc), which puts the client in
# no-telemetry mode and short-circuits gate eval to bundled defaults (all off).
alias cspy='env -u DISABLE_TELEMETRY -u DO_NOT_TRACK claude --append-system-prompt-file "$HOME/.claude/system-append.md"'
# claude-usage is now a function in ~/.config/zsh/functions/
alias aiu='ai-usage'
