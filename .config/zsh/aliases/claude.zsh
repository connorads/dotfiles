# https://github.com/anthropics/claude-code

# These session-launch aliases append the local system prompt that overrides
# Claude Code's Bash-tool git commit/branch note. The flag set comes from the
# shared claude-launch-flags owner (zsh word-splits the command substitution), so
# the append path lives in one place. Bare `claude` remains untouched, so
# subcommands like `claude update` and agent/script invocations stay vanilla.
alias c='claude $(claude-launch-flags)'
alias cy='claude $(claude-launch-flags --yolo)'
# cyc (yolo + the Telegram channel) is a function in functions/claude/, not an
# alias: it also backgrounds the post-launch claude-channels-check.
# cyf: yolo on fable. The flag is the durable form of the choice - the /model
# picker writes `model` into .claude/settings.json, which the claude-settings
# clean filter strips as machine-local state, so it never reaches other hosts.
alias cyf='claude $(claude-launch-flags --yolo) --model fable'
# cspy: launch with telemetry re-enabled so GrowthBook gates are evaluated
# live against the server. Everything else reads the cached result of that
# evaluation - CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF (in .zshrc) lets a
# no-telemetry session read the gate cache in ~/.claude.json, and nothing else
# refreshes it. So this is how the cache gets repopulated after a
# ~/.claude.json reset, and the only way preview/gated features (computer-use,
# channels) come back once it has gone stale.
alias cspy='env -u DISABLE_TELEMETRY -u DO_NOT_TRACK claude $(claude-launch-flags)'
alias cdp='claude-desktop-profile'
# claude-usage is now a function in ~/.config/zsh/functions/
alias aiu='ai-usage'
alias atp='agent-teleport'
