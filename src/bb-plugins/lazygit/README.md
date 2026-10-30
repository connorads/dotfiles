# Lazygit

Open or focus lazygit in the current thread's checkout with `Cmd+Shift+G`
or **Open lazygit** in the command palette. Git Glance's `l` key opens its selected
checkout, including linked worktrees outside the thread folder. Rebind the shortcut in
Settings → Keyboard. On Linux, use `Ctrl+Shift+G`.

BB 0.46 or later supplies the terminal-focus API. The host needs zsh and lazygit. The home-directory checkout uses the `lgdf`
shell function for the bare dotfiles repository. Other checkouts use `lazygit`.
The plugin starts an interactive zsh to load the host's shell functions.

```text
Shortcut → thread checkout → existing terminal or new lazygit session
Git Glance `l` → selected checkout → terminal scoped to thread and checkout path
```

`bb lazygit open <thread-id>` creates or reuses the same terminal and returns its
ID. The shortcut and the Git Glance key also bring that terminal into view.
Failures show in a notice at the bottom right for six seconds.
Selected-checkout terminals show the full path in their title. Paths pass as
literal process arguments. Selecting another checkout preserves existing terminals
and leaves the agent's working directory unchanged.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
