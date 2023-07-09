# dotfiles

[@connorads](https://github.com/connorads) dotfiles

- No symlinks
- Works with Sublime Merge

## Usage

If you've already got your dotfiles setup you can use the following commands to manage your dotfiles.

### Track file

```sh
dotfiles add -f .somefile
```

### Untrack file

```sh
dotfiles rm --cached .somefile
```

## Setup (from this repo)

If you want to (fork and) clone this repo and use it for your own dotfiles, follow these steps.

1. Clone repo

    ```sh
    git clone --bare https://github.com/connorads/dotfiles/ $HOME/git/dotfiles
    ```

2. Setup dotfiles (⚠️ this will overwrite existing dotfiles in home directory)

    ```sh
    $HOME/git/dotfiles/scripts/setup.sh
    ```

3. You can now reload shell and open Sublime Merge

    ```sh
    exec $SHELL
    smerge
    ```

## Setup (from scratch)

Follow these steps to recreate the setup for this repo from scratch.

1. Create repository to store dotfiles

    ```sh
    git init --bare $HOME/git/dotfiles
    ```

2. Change worktree to home directory

    ```sh
    cd $HOME/git/dotfiles
    git config --unset core.bare
    git config core.worktree $HOME
    ```

3. Ignore all files except `.gitignore` ([Sublime merge doesn't support status.showUntrackedFiles=no](https://github.com/sublimehq/sublime_merge/issues/1544))

    ```sh
    cd $HOME
    echo "/*" >> .gitignore
    echo "!.gitignore" >> .gitignore
    ```

4. Add alias to `.zshrc`

    ```sh
    echo "alias dotfiles='git --git-dir=$HOME/git/dotfiles/'" >> $HOME/.zshrc
    ```

## Credit

Inspired by

- [StreakyCobra's comment on Hacker News for idea to avoid symlinks with bare repo](https://news.ycombinator.com/item?id=11071754)
- [zwyx's blog post for Sublime Merge integration](https://zwyx.dev/blog/your-dotfiles-in-a-git-repo)
