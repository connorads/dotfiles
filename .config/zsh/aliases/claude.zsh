# https://github.com/anthropics/claude-code
alias c='claude'
alias cy='claude --dangerously-skip-permissions'
alias cyc='claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:telegram@claude-plugins-official'
# cspy: launch with telemetry re-enabled so GrowthBook gates fetch and
# preview/gated features (computer-use, channels) appear. We normally disable
# telemetry (DISABLE_TELEMETRY/DO_NOT_TRACK in .zshrc), which puts the client in
# no-telemetry mode and short-circuits gate eval to bundled defaults (all off).
alias cspy='env -u DISABLE_TELEMETRY -u DO_NOT_TRACK claude'
# claude-usage is now a function in ~/.config/zsh/functions/
alias aiu='ai-usage'
