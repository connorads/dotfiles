---
description: Add readonly/safe bash commands to allow list in opencode config
---

Analyze the bash commands from our recent conversation and identify commands that are:
- Read-only (no mutations/changes to system state)
- Non-dangerous (won't harm the system)
- Safe to execute without prompting

For each qualifying command, add it to the bash permissions "allow" list in ~/.config/opencode/opencode.json.

Guidelines for safe commands:
- List/view operations (ls, cat, grep, find, etc.)
- Status/info queries (git status, aws sts get-caller-identity, etc.)
- OpenCode readonly operations (opencode auth list, opencode models, etc.)
- Package manager view operations (npm view, brew audit, etc.)

DO NOT allow:
- Write operations (rm, mv, cp, etc.)
- State-changing operations (git push, npm install, etc.)
- Dangerous commands (eval, rm -rf, etc.)

Important: The wildcard (*) in command patterns matches ANY characters including flags and arguments.
For example, "brew info *" will match:
- brew info (no arguments)
- brew info package_name
- brew info --cask (the --cask flag is matched by *)
- brew info --cask package_name
- brew info --json=v2 package_name

You don't need separate patterns for different flags since the wildcard covers all variations.

After identifying commands, update the config file by adding new entries to the bash permissions section, maintaining alphabetical ordering within each category.
