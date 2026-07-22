# https://github.com/anthropics/claude-code

# These session-launch aliases append the local system prompt that overrides
# Claude Code's Bash-tool git commit/branch note. The flag set comes from the
# shared claude-launch-flags owner (zsh word-splits the command substitution), so
# the append path lives in one place. Bare `claude` remains untouched, so
# subcommands like `claude update` and agent/script invocations stay vanilla.
alias c='claude $(claude-launch-flags)'
alias cy='claude $(claude-launch-flags --yolo)'
alias cyc='claude $(claude-launch-flags --yolo) --channels plugin:telegram@claude-plugins-official'
# cspy: launch with telemetry re-enabled so GrowthBook gates fetch and
# preview/gated features (computer-use, channels) appear. We normally disable
# telemetry (DISABLE_TELEMETRY/DO_NOT_TRACK in .zshrc), which puts the client in
# no-telemetry mode and short-circuits gate eval to bundled defaults (all off).
alias cspy='env -u DISABLE_TELEMETRY -u DO_NOT_TRACK claude $(claude-launch-flags)'
# claude-usage is now a function in ~/.config/zsh/functions/
alias aiu='ai-usage'
