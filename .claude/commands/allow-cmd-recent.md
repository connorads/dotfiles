---
description: Review recent bash tool calls for whitelist candidates
allowed-tools: Bash(~/.claude/commands/allow-cmd-recent.sh:*)
---

First, run this command to extract recent bash commands (default 7 days, or pass a number for different window):

```
~/.claude/commands/allow-cmd-recent.sh $ARGUMENTS
```

Then analyse the output and identify commands that are:

- Read-only (no mutations/changes to system state)
- Non-dangerous (won't harm the system)
- Safe to execute without prompting

For each qualifying command, add it to the bash permissions "allow" list in ~/.claude/settings.json under `.permissions.allow`.

Guidelines for safe commands:

- List/view operations (ls, cat, grep, find, etc.)
- Status/info queries (git status, aws sts get-caller-identity, etc.)
- Package manager view operations (npm view, brew audit, etc.)
- Read-only CLI commands (--version, --help, list, view, etc.)

DO NOT allow:

- Write operations (rm, mv, cp, etc.)
- State-changing operations (git push, npm install, etc.)
- Dangerous commands (eval, rm -rf, etc.)

Important: The wildcard `*` in command patterns matches ANY characters including flags and arguments.
For example, `Bash(brew info:*)` will match:

- `brew info` (no arguments)
- `brew info package_name`
- `brew info --cask package_name`

The permission format is `Bash(command prefix:*)` where the prefix is matched against the start of commands.

After identifying commands, update ~/.claude/settings.json by adding new entries to the `.permissions.allow` array, maintaining alphabetical ordering within each category.
