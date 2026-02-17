---
description: Review recent bash tool calls for whitelist candidates
allowed-tools: Bash(~/.claude/commands/allow-cmd-recent.sh:*)
---

First, run this command to extract recent bash commands (default 7 days, or pass a number for different window):

```
~/.claude/commands/allow-cmd-recent.sh $ARGUMENTS
```

Then analyse the output and identify commands that are safe to auto-approve. The threat model is: **don't get pwned, don't do anything irreversible**.

Add qualifying commands to the bash permissions "allow" list in ~/.claude/settings.json under `.permissions.allow`.

## Safe — allow these:

- **Read-only operations**: ls, cat, grep, git status, git diff, git log, --version, --help, list, view, etc.
- **Local file creation tools**: yt-dlp, ffmpeg, ffprobe, python image/QR generators, etc. — these create local files but don't execute external code or modify system state
- **Build/check/lint/test/format commands**: pnpm run build, pnpm check, eslint, tsc, vitest, pytest, etc.
- **Git staging and committing**: git add, git commit — local and reversible
- **Dev servers**: pnpm dev, npm run dev, wrangler dev, etc.

## Unsafe — DO NOT allow:

- **External code installation**: npm/pnpm/pip/cargo/brew install, pnpm add — an agent could edit a manifest then install malicious packages
- **Arbitrary curl/wget**: curl to arbitrary URLs could fetch and pipe malicious scripts. Only allow specific safe patterns (curl -I, curl -s -o /dev/null -w)
- **Irreversible remote actions**: git push, deploy, publish, npm publish, gh release create
- **Destructive operations**: rm -rf, git reset --hard, git checkout -- (file), git clean
- **Arbitrary code execution**: eval, sh -c, bash -c, python -c (too open-ended)
- **Commands where the prefix could match dangerous subcommands/flags** (see prefix matching note below)

Important: The wildcard `*` in command patterns matches ANY characters including flags and arguments.
For example, `Bash(brew info:*)` will match:

- `brew info` (no arguments)
- `brew info package_name`
- `brew info --cask package_name`

The permission format is `Bash(command prefix:*)` where the prefix is matched against the start of commands.

After identifying commands, update ~/.claude/settings.json by adding new entries to the `.permissions.allow` array, maintaining alphabetical ordering within each category.
