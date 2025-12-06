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

After identifying commands, update the config file by adding new entries to the bash permissions section, maintaining alphabetical ordering within each category.
