---
name: clone-repository
description: Inspect the Clone Repository BB plugin and explain its palette and new-chat composer launchers.
---

# Clone Repository

Open **Clone repository…** from BB's palette or the new-chat composer's `+` menu.
The default shortcut is `Option+C` on macOS.
Select a repository or paste a GitHub URL or `owner/repo`, then check the destination.
The default destination is `~/git/<repo>`.

The plugin runs on the primary Mac with its existing GitHub CLI login and SSH access.
It opens a new-thread composer and preserves the current new-chat draft.
It does not submit a prompt or install project dependencies.

Run `bb clone-repository status` for a read-only host and discovery check.
The command reports a repository count without listing repository identities.
Cloning is a UI action; this command does not clone repositories.

If project registration fails, keep the checkout and use **Retry opening**.
An occupied destination with a different origin requires another path.
