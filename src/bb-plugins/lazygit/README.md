# Lazygit

Open or focus lazygit in the current thread's checkout with `Cmd+Shift+G`, `l` in
the Git Glance pop-up, or **Open lazygit** in the command palette. Rebind the shortcut in
Settings → Keyboard. On Linux, use `Ctrl+Shift+G`.

On the New thread screen, the shortcut uses the project picked in the composer.
It opens the reused environment when one is picked, else the project's default checkout.
These match the scopes the screen's terminal panel accepts.

BB 0.46 or later supplies the terminal-focus API. The host needs zsh and lazygit. The home-directory checkout uses the `lgdf`
shell function for the bare dotfiles repository. Other checkouts use `lazygit`.
The plugin starts an interactive zsh to load the host's shell functions.

```text
Shortcut or Git Glance `l` → composer's thread or picked project → existing terminal or new lazygit session
```

The command runs through the focused composer. An app overlay cannot show a
terminal, so each composer mounts an empty component whose navigator can.
The shortcut does nothing while a terminal has focus.

`bb lazygit open <thread-id>` creates or reuses the same terminal and returns its
ID. The shortcut and the Git Glance key also bring that terminal into view.
Failures show in a notice at the bottom right for six seconds.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
