# dotfiles

Use `git` (and [Sublime Merge](https://www.sublimemerge.com/)) to manage [dotfiles](https://en.wikipedia.org/wiki/Hidden_file_and_hidden_directory#Unix_and_Unix-like_environments) without using symlinks. Uses [brew](https://brew.sh/) to install software and [mise](https://github.com/connorads/mise/) to manage runtimes.

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

### Update Brewfile

```sh
brew bundle dump --force
```

## Setup (from this repo)

If you want to (fork and) clone this repo and use it for your own dotfiles, follow these steps.

1. Clone repo

    ```sh
    DOTFILES_REPO=https://github.com/connorads/dotfiles/
    DOTFILES_DIR=$HOME/git/dotfiles
    git clone --bare $DOTFILES_REPO $DOTFILES_DIR
    ```

2. Change worktree to home directory

    ```sh
    cd $DOTFILES_DIR
    git config --unset core.bare
    git config core.worktree $HOME
    ```

3. Put dotfiles from git into home directory (⚠️ this will overwrite existing dotfiles in home directory)

    ```sh
    cd $HOME
    git --git-dir=$DOTFILES_DIR/ checkout -f
    ```

4. Setup brew and install packages

    ```sh
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
    brew bundle install
    ```

5. You can now reload your shell and open Sublime Merge

    ```sh
    smerge $DOTFILES_DIR
    ```

## Setup (from scratch)

Follow these steps to recreate the setup for this repo from scratch.

1. Create repository to store dotfiles

    ```sh
    DOTFILES_DIR=$HOME/git/dotfiles
    git init --bare $DOTFILES_DIR
    ```

2. Change worktree to home directory

    ```sh
    cd $DOTFILES_DIR
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

5. You can now start [tracking files](#usage)

## Credit

Inspired by

- [StreakyCobra's comment on Hacker News for idea to avoid symlinks with bare repo](https://news.ycombinator.com/item?id=11071754)
- [zwyx's blog post for Sublime Merge integration](https://zwyx.dev/blog/your-dotfiles-in-a-git-repo)
