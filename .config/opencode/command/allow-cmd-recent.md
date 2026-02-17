---
description: Review recent bash tool calls for whitelist candidates
---

Analyse the bash commands from recent sessions and identify commands that are safe to auto-approve. The threat model is: **don't get pwned, don't do anything irreversible**.

Add qualifying commands to the bash permissions "allow" list in ~/.config/opencode/opencode.json.

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
For example, `brew info *` will match:

- `brew info` (no arguments)
- `brew info package_name`
- `brew info --cask` (the `*` flag is matched by `*`)
- `brew info --cask package_name`
- `brew info --json=v2 package_name`

You don't need separate patterns for different flags since the wildcard covers all variations.

After identifying commands, update the config file by adding new entries to the bash permissions section, maintaining alphabetical ordering within each category.

Extract unique bash commands from recent OpenCode sessions (default last 7 days), excluding commands already allowed in ~/.config/opencode/opencode.json.
Use the results below to decide which commands are safe to add to the allow list.

Note: multi-line commands are collapsed with literal `\n` in the output.
Args: optional days window (e.g. `/allow-cmd-recent 30`).

!`bash "$HOME/.config/opencode/command/allow-cmd-recent.sh" $ARGUMENTS`
