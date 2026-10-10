# Lazygit

Open or focus lazygit in the current thread's checkout with the header button,
`Cmd+Shift+G`, or **Open lazygit** in the command palette. Rebind the shortcut in
Settings → Keyboard. On Linux, use `Ctrl+Shift+G`.

BB 0.46 or later supplies the terminal-focus API. The host needs zsh and lazygit. The home-directory checkout uses the `lgdf`
shell function for the bare dotfiles repository. Other checkouts use `lazygit`.
The plugin starts an interactive zsh to load the host's shell functions.

```text
Button or shortcut → thread checkout → existing terminal or new lazygit session
```

`bb lazygit open <thread-id>` creates or reuses the same terminal and returns its
ID. The header button and shortcut also bring that terminal into view.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
