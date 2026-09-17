# Oyo PR Review

Run `oyp` from a repository to open the current branch's open PR with its review
comments. With no open PR or a detached HEAD, it opens local changes.

```bash
oyp
```

The executable symlink at `~/.local/bin/oyp` points to `oyp.sh`. The command needs
Oyo (`oy`), Git, and Bash 5. PR lookup also needs `gh` and `jq`. PR history must
be available locally. Running from home supports the dedicated dotfiles Git
repository.

The command preserves the branch, index and dirty files. Lookup and sync errors
return a non-zero exit status without waiting for input.

The tmux GitHub menu opens the same command in a floating pane. Its launcher
owns the pause after an error so the message stays visible until a key is pressed.

## Verification

From the dotfiles work-tree:

```bash
bats .config/zsh/tests/oyo.bats .config/zsh/tests/tmux-ghfzf.bats
```
