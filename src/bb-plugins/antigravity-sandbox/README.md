# Antigravity (Sandboxed)

Standalone BB provider plugin (`antigravity-sandbox`) that runs Antigravity (`agy acp`) inside a BB-managed macOS Seatbelt (or Linux `bwrap`) workspace-write sandbox, with native BB `auto` ("Approve for me") support and a mid-turn single-command approval escape tool (`run_unsandboxed_command`).

## How it works

1. **Workspace sandbox (`accept-edits` & `auto`):**
   - Launches `agy acp --process-per-session --dangerously-skip-permissions` inside a generated per-session Seatbelt profile (`sandbox-exec`) on macOS (avoiding `agy`'s internal `exebox` blocking `mise`, `/nix/store`, `~/.config/git/hooks`, and `127.0.0.1`).
   - Allows writes strictly to `cwd`, minimal linked-worktree Git metadata roots, `$BB_THREAD_STORAGE`, `$TMPDIR`, standard build caches, and `~/.gemini/antigravity-cli` (excluding `settings.json`).
   - Denies reads and writes to `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.bb/auth*`, `~/.netrc`, `~/.git-credentials`, `~/.local/share/agy-profiles`, and container daemon sockets.
2. **Mid-turn single-command escape (`run_unsandboxed_command`):**
   - Injected into the session's `bb-bridge` MCP server when sandboxed.
   - Calls trigger BB's native command-approval card (`interaction/request`). Only an approved single command runs unsandboxed in the host bridge; unattended turns (`permissionEscalation: "deny"`) auto-deny.
3. **Seamless mode switching (`auto` ↔ `full`):**
   - Switching a thread to `full` flips `BB_AGY_SANDBOX_MODE=off`, causing the ACP bridge to restart `agy` outside Seatbelt and restore the conversation via `session/load`.

## Build & install

```zsh
cd ~/src/bb-plugins
pnpm install
pnpm --dir antigravity-sandbox typecheck
pnpm --dir antigravity-sandbox test
pnpm --dir antigravity-sandbox build
bb plugin install path:~/src/bb-plugins/antigravity-sandbox --yes
```
